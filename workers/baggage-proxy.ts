/**
 * Cloudflare Worker: 인천국제공항공사 수하물 도착 정보 프록시.
 *
 * Vercel Serverless Function은 함수 실행 시간 제한(최대 60s, 플랜별로 더 짧음)이 있어
 * 공공데이터 서버 응답 지연(10~30s)이 겹치면 504 FUNCTION_INVOCATION_TIMEOUT이 발생한다.
 * Cloudflare Worker는 CPU 시간 제한만 있고(대기 시간은 제한되지 않음) Edge 캐싱을
 * 손쉽게 적용할 수 있어 이 프록시로 분리한다.
 *
 * 이 Worker는 단순 1:1 패스스루가 아니라, 기존 Vercel 함수(api/baggage-arrivals.ts)와
 * 동일하게 검색일(0/1/2) × 페이지를 서버에서 모두 모아 병합한 뒤 "완성된 하나의 응답"만
 * 반환한다. 그래야 클라이언트(`src/lib/baggageApi.ts`의 `needsFallbackFanout`)가
 * `totalCount > items.length`를 보고 브라우저에서 수십 번 추가 요청을 보내는 것을 막을 수 있다.
 *
 * 배포: `npm run worker:deploy` (wrangler.toml 참고)
 * 로컬 실행: `npm run worker:dev`
 */

export interface Env {
  /** Wrangler secret 또는 vars로 주입. 미설정 시 데모 서비스키로 대체. */
  SERVICE_KEY?: string;
  /** 필요 시 업스트림 베이스 URL을 다른 엔드포인트로 교체할 수 있음. */
  UPSTREAM_BASE_URL?: string;
}

/** .env 미설정 시에도 동작하도록 하는 데모 서비스키 — 운영 환경에서는 반드시 SERVICE_KEY로 교체할 것 */
const DEFAULT_SERVICE_KEY =
  "21c3a7130b45aa44a1f4c71804810b183e48a420fbb8a26721466ad626a0c6ea";

/**
 * 주의: `getBaggageArrivals`는 존재하지 않는(폐기된) 엔드포인트입니다
 * (공공데이터 포털이 `NO_OPENAPI_SERVICE_ERROR`를 반환함).
 * 실제 사용 가능한 엔드포인트는 `getFltArrivalsBaggageClaimDesk`이며,
 * `api/baggage-arrivals.ts`(Vercel 함수)에서도 동일한 엔드포인트를 사용 중입니다.
 */
const DEFAULT_UPSTREAM_BASE_URL =
  "https://apis.data.go.kr/B551177/statusOfBaggageClaimDesk/getFltArrivalsBaggageClaimDesk";

/** Edge에서 이 시간(초) 동안 완성된 병합 응답을 캐싱 — 매 폴링마다 업스트림 전체 재수집 방지 */
const AGGREGATE_CACHE_TTL_SECONDS = 50;

/** 업스트림이 완전히 죽었을 때도 이전 성공 응답을 얼마나 오래 재사용할지(초) */
const STALE_FALLBACK_TTL_SECONDS = 30 * 60;

/** 페이지 하나를 요청할 때 이 시간(ms) 안에 응답이 없으면 포기하고 재시도/폴백으로 넘어감 */
const PAGE_TIMEOUT_MS = 20_000;

/** 페이지 요청이 실패했을 때 몇 번까지 다시 시도할지 */
const PAGE_MAX_ATTEMPTS = 2;

/**
 * 공공데이터 응답 한 페이지 최대 행 수.
 * `numOfRows=1000`처럼 큰 페이지를 요청하면 업스트림 DB 조회가 무거워져 응답이 아예
 * 끊기고(525 SSL handshake) 실패하는 경우가 많음을 확인했다. 페이지를 작게 쪼개
 * 여러 번 빠르게 호출하는 쪽이 훨씬 안정적이다.
 */
const ROWS_PER_PAGE = 300;
/** 하루당 최대로 끌어올 페이지 수(안전 상한). 300 * 20 = 6000행까지 커버 */
const MAX_PAGE_PER_DAY = 20;
/** 오늘/내일/모레 3일치를 모아 프론트가 날짜를 넘겨봐도 데이터가 보이게 함 */
const SEARCH_DAYS = [0, 1, 2] as const;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function withCors(headers: HeadersInit = {}): Headers {
  const h = new Headers(headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) h.set(key, value);
  return h;
}

/** 캐시 키(신선/stale 공용) — 클라이언트 쿼리와 무관하게 "병합된 스냅샷 하나"만 캐싱 */
function snapshotCacheKey(request: Request, suffix: string): Request {
  const url = new URL(request.url);
  url.search = "";
  url.pathname = `/__snapshot_${suffix}__`;
  return new Request(url.toString(), { method: "GET" });
}

const extractItems = (json: unknown): unknown[] => {
  const itemsNode = (json as { response?: { body?: { items?: unknown } } })?.response?.body?.items;
  if (Array.isArray(itemsNode)) return itemsNode;
  if (Array.isArray((itemsNode as { item?: unknown[] } | undefined)?.item)) {
    return (itemsNode as { item: unknown[] }).item;
  }
  return [];
};

const extractTotalCount = (json: unknown): number => {
  const raw = (json as { response?: { body?: { totalCount?: unknown } } })?.response?.body?.totalCount;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

const buildAggregatedResponseBody = (items: unknown[]): string =>
  JSON.stringify({
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: {
        numOfRows: items.length,
        pageNo: 1,
        totalCount: items.length,
        items,
      },
    },
  });

async function fetchJsonWithRetry(url: string): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= PAGE_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
        // Cloudflare Edge 캐시: 개별 페이지 응답도 5분간 캐싱해 업스트림 호출 횟수 감소
        cf: { cacheTtl: 300, cacheEverything: true },
      });
      const text = await res.text();
      if (!res.ok) {
        lastError = new Error(`Upstream responded with ${res.status}`);
        continue;
      }
      try {
        return JSON.parse(text);
      } catch {
        lastError = new Error(`Upstream returned non-JSON: ${text.slice(0, 120)}`);
        continue;
      }
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upstream request failed");
}

async function fetchOnePage(
  upstreamBase: string,
  serviceKey: string,
  searchDay: number,
  pageNo: number
): Promise<{ items: unknown[]; totalCount: number }> {
  const query = new URLSearchParams({
    serviceKey,
    type: "json",
    numOfRows: String(ROWS_PER_PAGE),
    pageNo: String(pageNo),
    searchDay: String(searchDay),
  });
  const json = await fetchJsonWithRetry(`${upstreamBase}?${query.toString()}`);
  const items = extractItems(json);
  const totalCount = pageNo === 1 ? extractTotalCount(json) : 0;
  return { items, totalCount };
}

/** 검색일(0/1/2) × 페이지를 모두 모아 하나의 완성된 items 배열로 병합 */
async function fetchAggregatedSnapshot(upstreamBase: string, serviceKey: string): Promise<unknown[]> {
  const perDay = await Promise.all(
    SEARCH_DAYS.map(async (searchDay) => {
      const merged: unknown[] = [];
      const first = await fetchOnePage(upstreamBase, serviceKey, searchDay, 1);
      merged.push(...first.items);
      const plannedPages = Math.max(
        1,
        Math.min(MAX_PAGE_PER_DAY, Math.ceil(first.totalCount / ROWS_PER_PAGE))
      );
      if (plannedPages > 1) {
        const rest = await Promise.all(
          Array.from({ length: plannedPages - 1 }, (_, i) =>
            fetchOnePage(upstreamBase, serviceKey, searchDay, i + 2)
          )
        );
        for (const r of rest) merged.push(...r.items);
      }
      return merged;
    })
  );
  return perDay.flat();
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: withCors() });
    }

    if (request.method !== "GET") {
      return new Response(JSON.stringify({ message: "Method not allowed" }), {
        status: 405,
        headers: withCors({ "Content-Type": "application/json; charset=utf-8" }),
      });
    }

    const upstreamBase = (env.UPSTREAM_BASE_URL || DEFAULT_UPSTREAM_BASE_URL).replace(/\/$/, "");
    const serviceKey = env.SERVICE_KEY || DEFAULT_SERVICE_KEY;

    const cache = caches.default;
    const freshKey = snapshotCacheKey(request, "fresh");
    const staleKey = snapshotCacheKey(request, "stale");

    // 1분 폴링 대시보드이므로 짧은 시간(50s) 내 재요청은 캐시로 즉시 응답
    const fresh = await cache.match(freshKey);
    if (fresh) {
      const body = await fresh.text();
      return new Response(body, {
        status: 200,
        headers: withCors({
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Baggage-Proxy": "HIT",
        }),
      });
    }

    try {
      const items = await fetchAggregatedSnapshot(upstreamBase, serviceKey);
      const body = buildAggregatedResponseBody(items);

      ctx.waitUntil(
        Promise.all([
          cache.put(
            freshKey,
            new Response(body, {
              headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `max-age=${AGGREGATE_CACHE_TTL_SECONDS}` },
            })
          ),
          cache.put(
            staleKey,
            new Response(body, {
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": `max-age=${STALE_FALLBACK_TTL_SECONDS}`,
              },
            })
          ),
        ])
      );

      return new Response(body, {
        status: 200,
        headers: withCors({
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Baggage-Proxy": "MISS",
        }),
      });
    } catch (error) {
      // 업스트림이 완전히 실패 — 마지막 성공 스냅샷(stale)이 있으면 그것으로 응답
      const stale = await cache.match(staleKey);
      if (stale) {
        const body = await stale.text();
        return new Response(body, {
          status: 200,
          headers: withCors({
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Baggage-Proxy": "STALE-FALLBACK",
          }),
        });
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      return new Response(JSON.stringify({ message: `Upstream request failed: ${message}` }), {
        status: 502,
        headers: withCors({ "Content-Type": "application/json; charset=utf-8" }),
      });
    }
  },
};
