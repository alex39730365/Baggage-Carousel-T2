/**
 * Cloudflare Worker: 인천국제공항공사 수하물 도착 정보 프록시.
 *
 * Vercel Serverless Function은 함수 실행 시간 제한(최대 60s, 플랜별로 더 짧음)이 있어
 * 공공데이터 서버 응답 지연(10~30s)이 겹치면 504 FUNCTION_INVOCATION_TIMEOUT이 발생한다.
 * Cloudflare Worker는 CPU 시간 제한만 있고(대기 시간은 제한되지 않음) Edge 캐싱을
 * 손쉽게 적용할 수 있어 이 프록시로 분리한다.
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

/** Edge에서 5분(300s) 캐시 — 공공데이터 서버 부하 완화 */
const CACHE_TTL_SECONDS = 300;

/** 업스트림이 완전히 죽었을 때도 이전 성공 응답을 얼마나 오래 재사용할지(초) */
const STALE_FALLBACK_TTL_SECONDS = 30 * 60;

/** 업스트림 응답이 이 시간(ms) 안에 오지 않으면 포기하고 재시도/폴백으로 넘어감 */
const UPSTREAM_TIMEOUT_MS = 45_000;

/** 업스트림이 느리거나 순간적으로 실패할 때 몇 번까지 다시 시도할지 */
const MAX_ATTEMPTS = 2;

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

/** stale 폴백 저장용 캐시 키 — 클라이언트별 쿼리와 무관하게 "마지막 성공 응답" 하나만 보관 */
function staleFallbackCacheKey(request: Request): Request {
  const url = new URL(request.url);
  url.search = "";
  url.pathname = "/__stale_fallback__";
  return new Request(url.toString(), { method: "GET" });
}

async function fetchUpstreamOnce(upstreamUrl: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(upstreamUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      // Cloudflare Edge 캐시: 5분간 동일 요청 캐싱하여 업스트림 호출 횟수 감소
      cf: {
        cacheTtl: CACHE_TTL_SECONDS,
        cacheEverything: true,
      },
    });
  } finally {
    clearTimeout(timer);
  }
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

    const incomingUrl = new URL(request.url);
    const upstreamBase = (env.UPSTREAM_BASE_URL || DEFAULT_UPSTREAM_BASE_URL).replace(/\/$/, "");
    const serviceKey = env.SERVICE_KEY || DEFAULT_SERVICE_KEY;

    // 클라이언트가 보낸 query 파라미터(type, searchDay 등)를 그대로 원본 API로 전달
    const upstreamUrl = new URL(upstreamBase);
    for (const [key, value] of incomingUrl.searchParams) {
      if (key === "serviceKey") continue; // serviceKey는 서버 측 값을 우선 사용
      upstreamUrl.searchParams.set(key, value);
    }
    if (!upstreamUrl.searchParams.has("type")) upstreamUrl.searchParams.set("type", "json");
    upstreamUrl.searchParams.set("serviceKey", serviceKey);

    const cache = caches.default;
    const staleKey = staleFallbackCacheKey(request);

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const upstreamResponse = await fetchUpstreamOnce(upstreamUrl.toString(), UPSTREAM_TIMEOUT_MS);
        const body = await upstreamResponse.text();
        const contentType = upstreamResponse.headers.get("Content-Type") || "application/json; charset=utf-8";

        if (!upstreamResponse.ok) {
          lastError = new Error(`Upstream responded with ${upstreamResponse.status}`);
          continue;
        }

        const response = new Response(body, {
          status: upstreamResponse.status,
          headers: withCors({
            "Content-Type": contentType,
            "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
            "X-Baggage-Proxy": "LIVE",
          }),
        });

        // 다음 완전 장애 시 서빙할 stale 폴백 저장(비동기, 응답 지연 없음)
        const toCache = new Response(body, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": `public, max-age=${STALE_FALLBACK_TTL_SECONDS}`,
          },
        });
        ctx.waitUntil(cache.put(staleKey, toCache));

        return response;
      } catch (error) {
        lastError = error;
      }
    }

    // 업스트림이 완전히 실패 — 마지막 성공 응답(stale)이 있으면 그것으로 응답
    const stale = await cache.match(staleKey);
    if (stale) {
      const body = await stale.text();
      return new Response(body, {
        status: 200,
        headers: withCors({
          "Content-Type": stale.headers.get("Content-Type") || "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Baggage-Proxy": "STALE-FALLBACK",
        }),
      });
    }

    const message = lastError instanceof Error ? lastError.message : "Unknown error";
    return new Response(JSON.stringify({ message: `Upstream request failed: ${message}` }), {
      status: 502,
      headers: withCors({ "Content-Type": "application/json; charset=utf-8" }),
    });
  },
};
