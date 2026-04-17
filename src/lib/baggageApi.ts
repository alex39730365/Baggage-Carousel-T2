import { BaggageSlot, RawBaggageItem } from "../types";

const API_URL =
  "/api/baggage-arrivals?numOfRows=1000&pageNo=1&searchDay=0&type=json";

const API_URL_CANDIDATES = [API_URL];

const pickString = (obj: RawBaggageItem, keys: string[]): string => {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const firstNumberInString = (value: string): number | null => {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : null;
};

const toHour = (dateText: string): string => {
  if (!dateText) return "00:00";
  const onlyDigits = dateText.replace(/\D/g, "");
  if (onlyDigits.length >= 10) {
    const hh = onlyDigits.slice(8, 10);
    return `${hh}:00`;
  }
  const hm = dateText.match(/(\d{1,2}):(\d{2})/);
  if (hm) return `${hm[1].padStart(2, "0")}:00`;
  return "00:00";
};

const parseCarouselNumbers = (item: RawBaggageItem): number[] => {
  const texts = [
    pickString(item, [
      "lateral1",
      "lateralNo",
      "lateralNum",
      "lateral1No",
      "carouselNo",
      "carousel",
      "bagCarouselId",
    ]),
    pickString(item, ["lateral2", "bagCarouselId2"]),
  ].filter(Boolean);

  const result = new Set<number>();
  for (const text of texts) {
    const matches = text.match(/\d+/g) ?? [];
    for (const m of matches) {
      const n = Number(m);
      if (n >= 1 && n <= 19) result.add(n);
    }
  }
  return [...result];
};

const normalizeItem = (item: RawBaggageItem): BaggageSlot[] => {
  const flight = pickString(item, ["flightId", "flightNo", "airlineFlightNo", "airline"]);
  const typeOfFlight = pickString(item, ["typeOfFlight", "flightType"]).toUpperCase();
  if (typeOfFlight !== "I") return [];
  const flightNumber = firstNumberInString(flight);
  if (flightNumber === null || flightNumber % 2 === 1) return [];

  const estimatedTime = pickString(item, [
    "estimatedDatetime",
    "estimatedDateTime",
    "estimatedTime",
    "scheduleDateTime",
    "std",
  ]);
  const status = pickString(item, [
    "lateral1Status",
    "lateralStatus",
    "status",
    "baggageStatus",
    "bagRemark",
  ]);
  const pieces = pickString(item, ["baggagePieces", "pc", "pieces", "cargoCount"]);
  const note = pickString(item, ["remark", "note", "specialRemark"]);

  const carousels = parseCarouselNumbers(item);
  if (carousels.length === 0) return [];

  return carousels.map((carousel) => ({
    hour: toHour(estimatedTime),
    carousel,
    flight,
    estimatedTime,
    status,
    pieces,
    note,
    raw: item,
  }));
};

export const buildHourRows = (): string[] => {
  return Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
};

export async function fetchBaggageSlots(): Promise<BaggageSlot[]> {
  let response: Response | null = null;
  let lastError = "";

  for (const url of API_URL_CANDIDATES) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) {
        response = res;
        break;
      }
      lastError = `API 요청 실패 (${res.status})`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "요청 실패";
    }
  }
  if (!response) throw new Error(lastError || "API 요청 실패");

  const json = await response.json();
  const itemsNode = json?.response?.body?.items;
  const items: unknown[] = Array.isArray(itemsNode)
    ? itemsNode
    : Array.isArray(itemsNode?.item)
    ? itemsNode.item
    : [];

  return items.flatMap((item) => normalizeItem(item as RawBaggageItem));
}
