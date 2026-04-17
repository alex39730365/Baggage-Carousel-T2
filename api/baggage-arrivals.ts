const DEFAULT_SERVICE_KEY = "21c3a7130b45aa44a1f4c71804810b183e48a420fbb8a26721466ad626a0c6ea";
const OPEN_API_URL =
  "https://apis.data.go.kr/B551177/statusOfBaggageClaimDesk/getFltArrivalsBaggageClaimDesk";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY || DEFAULT_SERVICE_KEY;
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

    res.setHeader("Cache-Control", "s-maxage=240, stale-while-revalidate=60");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(response.status).send(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ message: `Upstream request failed: ${message}` });
  }
}
