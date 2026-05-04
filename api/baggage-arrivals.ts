import { createClient } from "@vercel/kv";

/** 공공데이터 포털 기본 엔드포인트 — `BAGGAGE_DATA_UPSTREAM_URL`로 교체 가능 */
const DEFAULT_PAGINATED_UPSTREAM_BASE =
  "https://apis.data.go.kr/B551177/statusOfBaggageClaimDesk/getFltArrivalsBaggageClaimDesk";

function processEnv(): Record<string, string | undefined> {
  return ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ??
    {}) as Record<string, string | undefined>;
}

function paginatedUpstreamBase(): string {
  const e = processEnv();
  const u = String(e.BAGGAGE_DATA_UPSTREAM_URL ?? e.DATA_GO_KR_UPSTREAM_URL ?? "").trim();
  return u || DEFAULT_PAGINATED_UPSTREAM_BASE;
}

function snapshotUpstreamUrl(): string {
  return String(processEnv().BAGGAGE_UPSTREAM_SNAPSHOT_URL ?? "").trim();
}

function useSnapshotUpstream(): boolean {
  return Boolean(snapshotUpstreamUrl());
}

function shouldAppendPaginatedServiceKey(): boolean {
  const v = String(processEnv().BAGGAGE_PAGINATED_APPEND_SERVICE_KEY ?? "true").toLowerCase();
  return v !== "false" && v !== "0" && v !== "no";
}

/** .env 미설정 시에도 데모 키로 동작해 503(키 누락) 방지 */
const DEV_FALLBACK_SERVICE_KEY =
  "21c3a7130b45aa44a1f4c71804810b183e48a420fbb8a26721466ad626a0c6ea";

/**
 * 스냅샷 유효 시간 — 이 안에는 메모리·KV·공공데이터 재호출 없음.
 * `useBaggageData` REFRESH_MS와 동일하게 유지.
 */
const UPSTREAM_CACHE_TTL_MS = 60 * 1000;

const SNAPSHOT_KV_KEY = "baggage:snapshot-v3";
const SNAPSHOT_LOCK_KEY = "baggage:snapshot-lock-v3";
/**
 * Redis 키 TTL(초) — 물리 보관은 길게(업스트림 실패 시 STALE 폴백용).
 * 논리상 "신선" 여부는 tryReadKvSnapshot의 UPSTREAM_CACHE_TTL_MS로만 판단.
 */
const SNAPSHOT_KV_TTL_SEC = 15 * 60;
const LOCK_TTL_SEC = 50;

/** 업스트림 오류 시에도 응답 가능한 최대 스냅샷 나이 */
const STALE_FALLBACK_MAX_MS = 15 * 60 * 1000;

/**
 * 브라우저·CDN이 동일 JSON을 재사용.
 */
const BROWSER_MAX_AGE_SEC = 45;
const CDN_S_MAXAGE_SEC = 60;
const CDN_STALE_WHILE_REVALIDATE_SEC = 300;

const successCacheControl = () =>
  [
    "public",
    `max-age=${BROWSER_MAX_AGE_SEC}`,
    `s-maxage=${CDN_S_MAXAGE_SEC}`,
    `stale-while-revalidate=${CDN_STALE_WHILE_REVALIDATE_SEC}`,
  ].join(", ");

const cdnCacheControlOnly = () =>
  `public, s-maxage=${CDN_S_MAXAGE_SEC}, stale-while-revalidate=${CDN_STALE_WHILE_REVALIDATE_SEC}`;

const SNAPSHOT_CACHE_KEY = "snapshot-v1";
const ROWS_PER_PAGE = 1000;
const MAX_PAGE_PER_DAY = 15;
const SEARCH_DAYS = [0, 1, 2] as const;

type CachedPayload = {
  status: number;
  body: string;
  contentType: string;
  createdAt: number;
};

const responseCache = new Map<string, CachedPayload>();
const inflightRequests = new Map<string, Promise<CachedPayload>>();

let kvSingleton: ReturnType<typeof createClient> | null = null;

function getKvClient() {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const url = String(env?.KV_REST_API_URL ?? "").trim();
  const token = String(env?.KV_REST_API_TOKEN ?? "").trim();
  if (!url || !token) return null;
  if (!kvSingleton) kvSingleton = createClient({ url, token });
  return kvSingleton;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function tryReadKvSnapshot(kv: NonNullable<ReturnType<typeof getKvClient>>): Promise<CachedPayload | null> {
  try {
    const raw = await kv.get(SNAPSHOT_KV_KEY);
    if (typeof raw !== "string" || !raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (!parsed?.body || typeof parsed.createdAt !== "number" || parsed.status !== 200) return null;
    if (Date.now() - parsed.createdAt >= UPSTREAM_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeKvSnapshot(kv: NonNullable<ReturnType<typeof getKvClient>>, payload: CachedPayload) {
  try {
    await kv.set(SNAPSHOT_KV_KEY, JSON.stringify(payload), { ex: SNAPSHOT_KV_TTL_SEC });
  } catch {
    // ignore
  }
}

async function getStaleFallbackPayload(
  kv: ReturnType<typeof getKvClient>,
  cacheKey: string
): Promise<CachedPayload | null> {
  const mem = responseCache.get(cacheKey);
  if (mem && mem.status === 200 && Date.now() - mem.createdAt < STALE_FALLBACK_MAX_MS) return mem;
  if (!kv) return null;
  try {
    const raw = await kv.get(SNAPSHOT_KV_KEY);
    if (typeof raw !== "string" || !raw) return null;
    const parsed = JSON.parse(raw) as CachedPayload;
    if (!parsed?.body || typeof parsed.createdAt !== "number" || parsed.status !== 200) return null;
    if (Date.now() - parsed.createdAt >= STALE_FALLBACK_MAX_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

const extractItems = (json: any): any[] => {
  const itemsNode = json?.response?.body?.items;
  if (Array.isArray(itemsNode)) return itemsNode;
  if (Array.isArray(itemsNode?.item)) return itemsNode.item;
  return [];
};

const extractTotalCount = (json: any): number => {
  const raw = json?.response?.body?.totalCount;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

const buildSnapshotResponse = (items: any[]) => ({
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

async function fetchOnePage(
  serviceKey: string,
  searchDay: (typeof SEARCH_DAYS)[number],
  pageNo: number
): Promise<{ items: any[]; totalCount: number }> {
  const query = new URLSearchParams();
  if (shouldAppendPaginatedServiceKey()) query.set("serviceKey", serviceKey);
  query.set("type", "json");
  query.set("numOfRows", String(ROWS_PER_PAGE));
  query.set("pageNo", String(pageNo));
  query.set("searchDay", String(searchDay));
  const target = `${paginatedUpstreamBase()}?${query.toString()}`;

  const response = await fetch(target, { method: "GET" });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Upstream failed (${response.status})`);
  }
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Upstream non-JSON: ${text.trim().slice(0, 120)}`);
  }
  const items = extractItems(json);
  const totalCount = pageNo === 1 ? extractTotalCount(json) : 0;
  return { items, totalCount };
}

async function fetchUpstreamFromSnapshot(): Promise<CachedPayload> {
  const env = processEnv();
  const url = snapshotUpstreamUrl();
  const auth = String(env.BAGGAGE_UPSTREAM_AUTHORIZATION ?? "").trim();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (auth) headers.Authorization = auth;

  const response = await fetch(url, { method: "GET", headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Snapshot upstream failed (${response.status})`);
  }
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Snapshot upstream non-JSON: ${text.trim().slice(0, 120)}`);
  }

  const hasGovShape =
    json?.response?.body &&
    (Array.isArray(json.response.body.items) || Array.isArray(json.response.body.items?.item));

  let body: string;
  if (hasGovShape) {
    body = JSON.stringify(json);
  } else {
    const items = extractItems(json);
    const list = items.length > 0 ? items : Array.isArray(json) ? json : [];
    if (!list.length) {
      throw new Error("Snapshot upstream: empty or unrecognized JSON (expected items or 공공데이터 response shape)");
    }
    body = JSON.stringify(buildSnapshotResponse(list));
  }

  return {
    status: 200,
    body,
    contentType: "application/json; charset=utf-8",
    createdAt: Date.now(),
  };
}

async function fetchUpstreamPayload(serviceKey: string): Promise<CachedPayload> {
  const perDay = await Promise.all(
    SEARCH_DAYS.map(async (searchDay) => {
      const merged: any[] = [];
      const first = await fetchOnePage(serviceKey, searchDay, 1);
      merged.push(...first.items);
      const totalCount = first.totalCount;
      const plannedPages = Math.max(1, Math.min(MAX_PAGE_PER_DAY, Math.ceil(totalCount / ROWS_PER_PAGE)));
      if (plannedPages > 1) {
        const rest = await Promise.all(
          Array.from({ length: plannedPages - 1 }, (_, i) => fetchOnePage(serviceKey, searchDay, i + 2))
        );
        for (const r of rest) merged.push(...r.items);
      }
      return merged;
    })
  );
  const merged = perDay.flat();

  const body = JSON.stringify(buildSnapshotResponse(merged));
  return {
    status: 200,
    body,
    contentType: "application/json; charset=utf-8",
    createdAt: Date.now(),
  };
}

function sendPayload(
  res: any,
  payload: CachedPayload,
  cacheTag: string
) {
  res.setHeader("Cache-Control", successCacheControl());
  res.setHeader("CDN-Cache-Control", cdnCacheControlOnly());
  res.setHeader("Content-Type", payload.contentType);
  res.setHeader("X-Baggage-Cache", cacheTag);
  res.status(payload.status).send(payload.body);
}

function applyCors(res: any) {
  const origin = String(processEnv().BAGGAGE_API_CORS_ORIGIN ?? "").trim();
  if (!origin) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export default async function handler(req: any, res: any) {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const snapshotMode = useSnapshotUpstream();
  const fromEnv = String(processEnv().DATA_GO_KR_SERVICE_KEY ?? "").trim();
  const serviceKey = fromEnv || DEV_FALLBACK_SERVICE_KEY;

  if (!snapshotMode && !serviceKey) {
    res.status(503).json({
      message:
        "DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다. Vercel Production 프로젝트 환경 변수에 공공데이터 서비스키를 추가하거나, 사내 API용 BAGGAGE_UPSTREAM_SNAPSHOT_URL을 설정해 주세요.",
    });
    return;
  }

  const cacheKey = SNAPSHOT_CACHE_KEY;
  const now = Date.now();
  const cached = responseCache.get(cacheKey);
  if (cached && now - cached.createdAt < UPSTREAM_CACHE_TTL_MS) {
    sendPayload(res, cached, "HIT");
    return;
  }

  const kv = getKvClient();
  if (kv) {
    try {
      const fromKv = await tryReadKvSnapshot(kv);
      if (fromKv) {
        responseCache.set(cacheKey, fromKv);
        sendPayload(res, fromKv, "KV-HIT");
        return;
      }
    } catch {
      // KV 오류 시 아래에서 공공데이터로 폴백
    }
  }

  let acquiredLock = false;
  if (kv) {
    try {
      let lockRes = await kv.set(SNAPSHOT_LOCK_KEY, "1", { ex: LOCK_TTL_SEC, nx: true });
      acquiredLock = lockRes != null;
      if (!acquiredLock) {
        for (let i = 0; i < 48; i++) {
          await sleep(250);
          const retry = await tryReadKvSnapshot(kv);
          if (retry) {
            responseCache.set(cacheKey, retry);
            sendPayload(res, retry, "KV-JOIN");
            return;
          }
        }
        lockRes = await kv.set(SNAPSHOT_LOCK_KEY, "1", { ex: LOCK_TTL_SEC, nx: true });
        acquiredLock = lockRes != null;
      }
    } catch {
      acquiredLock = false;
    }
  }

  const runUpstream = async (): Promise<CachedPayload> => {
    const payload = snapshotMode
      ? await fetchUpstreamFromSnapshot()
      : await fetchUpstreamPayload(serviceKey);
    responseCache.set(cacheKey, payload);
    if (kv) await writeKvSnapshot(kv, payload);
    return payload;
  };

  try {
    const pending = inflightRequests.get(cacheKey);
    const payloadPromise = pending ?? runUpstream();
    if (!pending) inflightRequests.set(cacheKey, payloadPromise);

    const payload = await payloadPromise;
    inflightRequests.delete(cacheKey);

    sendPayload(res, payload, pending ? "JOIN" : "MISS");
  } catch (error) {
    inflightRequests.delete(cacheKey);
    const stale = await getStaleFallbackPayload(kv, cacheKey);
    if (stale) {
      responseCache.set(cacheKey, stale);
      sendPayload(res, stale, "STALE-FALLBACK");
      return;
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: `Upstream request failed: ${message}` });
  } finally {
    if (kv && acquiredLock) {
      try {
        await kv.del(SNAPSHOT_LOCK_KEY);
      } catch {
        // ignore
      }
    }
  }
}
