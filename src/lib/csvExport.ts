/**
 * CSV 보내기 스펙(요약). 전체·변경 이력은 `docs/CSV_EXPORT.md`.
 *
 * - 인코딩: UTF-8, 선행 BOM(`\\uFEFF`) — Excel(Windows)에서 한글 열 깨짐 완화.
 * - 줄바꿈: CRLF(`\\r\\n`).
 * - 데이터 범위: 호출 시점의 `BaggageSlot[]` 그대로(화면 `visibleSlots`와 맞추는 것은 호출 쪽 책임).
 * - 시각 열: `YYYYMMDDHHmm[ss]` 형태는 Excel이 큰 수로 읽는 문제를 피하려 `spreadsheetSafeDateTime`으로 가공.
 *
 * @see docs/CSV_EXPORT.md
 */
import type { BaggageSlot } from "../types";

const rawField = (raw: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  }
  return "";
};

const escapeCsvCell = (value: string): string => {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
};

/**
 * Excel이 `YYYYMMDDHHmm` 연속 숫자를 큰 수로 받아 E+11로 보이는 것을 막기 위해 `:`가 들어간 문자열로 바꿈.
 * 행의 `날짜` 열과 중복되지 않도록 날짜(YYYYMMDD)는 빼고 시·분(·초)만 둔다.
 */
export function spreadsheetSafeDateTime(value: string): string {
  const t = value.trim();
  if (!t) return "";
  const d = t.replace(/\D/g, "");
  if (d.length >= 12) {
    const hh = d.slice(8, 10);
    const mm = d.slice(10, 12);
    return d.length >= 14 ? `${hh}:${mm}:${d.slice(12, 14)}` : `${hh}:${mm}`;
  }
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return t;
}

/** `visibleSlots` 등 화면과 동일한 슬롯 배열 → CSV 본문(UTF-8 BOM 선행, CRLF 줄바꿈). */
export function buildBaggageSlotsCsv(slots: BaggageSlot[]): string {
  const headers = [
    "날짜",
    "시간대",
    "케로셀",
    "편명",
    "국내외",
    "예정시각",
    "상태",
    "수하물",
    "비고",
    "스탠드",
    "착륙시각",
    "첫수하물",
    "마지막수하물",
  ];
  const headerLine = headers.map(escapeCsvCell).join(",");
  const bodyLines = slots.map((s) => {
    const raw = (s.raw ?? {}) as Record<string, unknown>;
    const landing = rawField(raw, ["landingDatetime", "landingDateTime"]);
    const bagFirst = rawField(raw, ["bagFirstTime", "bagfirstTime"]);
    const bagLast = rawField(raw, ["bagLastTime", "baglastTime"]);
    const cols = [
      s.date,
      s.hour,
      String(s.carousel),
      s.flight,
      s.typeOfFlight,
      spreadsheetSafeDateTime(s.estimatedTime),
      s.status,
      s.pieces,
      s.note,
      rawField(raw, ["fstandPosition", "gateNumber"]),
      spreadsheetSafeDateTime(landing),
      spreadsheetSafeDateTime(bagFirst),
      spreadsheetSafeDateTime(bagLast),
    ];
    return cols.map((c) => escapeCsvCell(String(c))).join(",");
  });
  return `\uFEFF${[headerLine, ...bodyLines].join("\r\n")}\r\n`;
}

export function downloadCsvFile(filename: string, csvText: string): void {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
