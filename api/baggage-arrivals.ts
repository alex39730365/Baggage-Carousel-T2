import { createClient } from "@vercel/kv";

const OPEN_API_URL =
  "https://apis.data.go.kr/B551177/statusOfBaggageClaimDesk/getFltArrivalsBaggageClaimDesk";

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
/** Redis 키 TTL(초) — 논리 TTL(60s)보다 약간 길게 */
const SNAPSHOT_KV_TTL_SEC = 90;
const LOCK_TTL_SEC = 50;

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

async function fetchUpstreamPayload(serviceKey: string): Promise<CachedPayload> {
  const merged: any[] = [];

  for (const searchDay of SEARCH_DAYS) {
    let plannedPages = 1;
    for (let pageNo = 1; pageNo <= plannedPages && pageNo <= MAX_PAGE_PER_DAY; pageNo++) {
      const query = new URLSearchParams();
      query.set("serviceKey", serviceKey);
      query.set("type", "json");
      query.set("numOfRows", String(ROWS_PER_PAGE));
      query.set("pageNo", String(pageNo));
      query.set("searchDay", String(searchDay));
      const target = `${OPEN_API_URL}?${query.toString()}`;

      const response = await fetch(target, { method: "GET" });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Upstream failed (${response.status})`);
      }
      const json = JSON.parse(text);
      const items = extractItems(json);
      if (pageNo === 1) {
        const totalCount = extractTotalCount(json);
        plannedPages = Math.max(1, Math.min(MAX_PAGE_PER_DAY, Math.ceil(totalCount / ROWS_PER_PAGE)));
      }
      merged.push(...items);
      if (items.length < ROWS_PER_PAGE) break;
    }
  }

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

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const fromEnv = String((globalThis as any)?.process?.env?.DATA_GO_KR_SERVICE_KEY ?? "").trim();
  const serviceKey = fromEnv || DEV_FALLBACK_SERVICE_KEY;

  if (!serviceKey) {
    res.status(503).json({
      message:
        "DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다. Vercel Production 프로젝트 환경 변수에 공공데이터 서비스키를 추가해 주세요.",
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
    const payload = await fetchUpstreamPayload(serviceKey);
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
