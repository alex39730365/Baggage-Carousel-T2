const OPEN_API_URL =
  "https://apis.data.go.kr/B551177/statusOfBaggageClaimDesk/getFltArrivalsBaggageClaimDesk";

/** .env 미설정 시에도 데모 키로 동작해 503(키 누락) 방지 */
const DEV_FALLBACK_SERVICE_KEY =
  "21c3a7130b45aa44a1f4c71804810b183e48a420fbb8a26721466ad626a0c6ea";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const fromEnv = String(process.env.DATA_GO_KR_SERVICE_KEY ?? "").trim();
  const serviceKey = fromEnv || DEV_FALLBACK_SERVICE_KEY;

  if (!serviceKey) {
    res.status(503).json({
      message:
        "DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다. Vercel Production 프로젝트 환경 변수에 공공데이터 서비스키를 추가해 주세요.",
    });
    return;
  }
  const incoming = req.query ?? {};
  const query = new URLSearchParams();

  query.set("serviceKey", serviceKey);
  query.set("type", String(incoming.type ?? "json"));
  query.set("numOfRows", String(incoming.numOfRows ?? "1000"));
  query.set("pageNo", String(incoming.pageNo ?? "1"));
  query.set("searchDay", String(incoming.searchDay ?? "0"));

  const target = `${OPEN_API_URL}?${query.toString()}`;

  try {
    const response = await fetch(target, { method: "GET" });
    const text = await response.text();

    // Vercel edge 캐시를 60초로 맞춰 다수 사용자 요청을 한 번에 흡수
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(response.status).send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: `Upstream request failed: ${message}` });
  }
}
