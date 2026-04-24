const OPEN_API_URL =
  "https://apis.data.go.kr/B551177/statusOfBaggageClaimDesk/getFltArrivalsBaggageClaimDesk";

/** .env 미설정 시에도 데모 키로 동작해 503(키 누락) 방지 */
const DEV_FALLBACK_SERVICE_KEY =
  "21c3a7130b45aa44a1f4c71804810b183e48a420fbb8a26721466ad626a0c6ea";

const UPSTREAM_CACHE_TTL_MS = 60 * 1000;
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
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
    res.setHeader("Content-Type", cached.contentType);
    res.setHeader("X-Baggage-Cache", "HIT");
    res.status(cached.status).send(cached.body);
    return;
  }

  try {
    const runFetch = async (): Promise<CachedPayload> => {
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
            plannedPages = Math.max(
              1,
              Math.min(MAX_PAGE_PER_DAY, Math.ceil(totalCount / ROWS_PER_PAGE))
            );
          }
          merged.push(...items);
          if (items.length < ROWS_PER_PAGE) break;
        }
      }

      const body = JSON.stringify(buildSnapshotResponse(merged));
      const payload: CachedPayload = {
        status: 200,
        body,
        contentType: "application/json; charset=utf-8",
        createdAt: Date.now(),
      };
      responseCache.set(cacheKey, payload);
      return payload;
    };

    const pending = inflightRequests.get(cacheKey);
    const payloadPromise = pending ?? runFetch();
    if (!pending) inflightRequests.set(cacheKey, payloadPromise);

    const payload = await payloadPromise;
    inflightRequests.delete(cacheKey);

    // Vercel edge 캐시를 60초로 맞춰 다수 사용자 요청을 한 번에 흡수
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
    res.setHeader("Content-Type", payload.contentType);
    res.setHeader("X-Baggage-Cache", pending ? "JOIN" : "MISS");
    res.status(payload.status).send(payload.body);
  } catch (error) {
    inflightRequests.delete(cacheKey);
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: `Upstream request failed: ${message}` });
  }
}
