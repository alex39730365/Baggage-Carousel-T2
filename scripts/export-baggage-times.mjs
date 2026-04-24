/**
 * 인천공항 수하물 수취대 API에서 첫/마지막 수하물 도착시간 등을 뽑아 JSON으로 저장합니다.
 * 실행: node scripts/export-baggage-times.mjs
 */
const BASE =
  "https://apis.data.go.kr/B551177/statusOfBaggageClaimDesk/getFltArrivalsBaggageClaimDesk";
const SERVICE_KEY =
  process.env.DATA_GO_KR_SERVICE_KEY ||
  "21c3a7130b45aa44a1f4c71804810b183e48a420fbb8a26721466ad626a0c6ea";

const ROWS = 500;
const MAX_PAGES = 10;

function fmtYmdHm(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  if (d.length < 12) return digits || "";
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${d.slice(8, 10)}:${d.slice(10, 12)}`;
}

async function fetchPage(searchDay, pageNo) {
  const q = new URLSearchParams({
    serviceKey: SERVICE_KEY,
    type: "json",
    numOfRows: String(ROWS),
    pageNo: String(pageNo),
    searchDay: String(searchDay),
  });
  const res = await fetch(`${BASE}?${q}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  const body = json?.response?.body;
  const items = body?.items;
  const list = Array.isArray(items) ? items : items?.item ? [].concat(items.item) : [];
  const total = Number(body?.totalCount ?? 0);
  return { list, total };
}

function mapRow(it) {
  return {
    airline: it.airline,
    airlineCode: it.airlineCode,
    codeshare: it.codeshare,
    masterFlightId: it.masterFlightId,
    flightId: it.flightId,
    scheduleDatetime: it.scheduleDatetime,
    scheduleLocal: fmtYmdHm(it.scheduleDatetime),
    estimatedDatetime: it.estimatedDatetime,
    estimatedLocal: fmtYmdHm(it.estimatedDatetime),
    terminalId: it.terminalId,
    flightServiceType: it.flightServiceType,
    remark: it.remark,
    bagRemark: it.bagRemark,
    typeOfFlight: it.typeOfFlight,
    aircraftType: it.aircraftType,
    aircraftSubtype: it.aircraftSubtype,
    aircraftRegNo: it.aircraftRegNo,
    fstandPosition: it.fstandPosition,
    runway: it.runway,
    bagCarouselId: it.bagCarouselId,
    bagFirstTime: it.bagFirstTime,
    bagFirstLocal: fmtYmdHm(it.bagFirstTime),
    bagLastTime: it.bagLastTime,
    bagLastLocal: fmtYmdHm(it.bagLastTime),
    gateNo: it.gateNo,
    exit: it.exit,
    airportCode: it.airportCode,
    airport: it.airport,
    landingDatetime: it.landingDatetime,
    landingLocal: fmtYmdHm(it.landingDatetime),
    tmp1: it.tmp1,
    tmp2: it.tmp2,
  };
}

async function main() {
  const out = [];
  const seen = new Set();

  for (const searchDay of [0, 1, 2]) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { list, total } = await fetchPage(searchDay, page);
      for (const it of list) {
        const key = `${it.flightId}|${it.scheduleDatetime}|${it.bagCarouselId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(mapRow(it));
      }
      if (list.length < ROWS) break;
      if (page * ROWS >= total) break;
    }
  }

  out.sort((a, b) => String(a.scheduleDatetime).localeCompare(String(b.scheduleDatetime)));

  const path = new URL("../icn-baggage-with-first-last.json", import.meta.url);
  const fs = await import("node:fs/promises");
  await fs.writeFile(path, JSON.stringify({ exportedAt: new Date().toISOString(), count: out.length, rows: out }, null, 2), "utf8");
  console.log(`Wrote ${out.length} rows to ${path.pathname}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
