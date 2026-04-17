import { BaggageSlot, RawBaggageItem } from "../types";

const API_URLS = [0, 1, 2].map(
  (searchDay) =>
    `/api/baggage-arrivals?numOfRows=1000&pageNo=1&searchDay=${searchDay}&type=json`
);

const pickString = (obj: RawBaggageItem, keys: string[]): string => {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
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

const toDateKey = (dateText: string): string => {
  const onlyDigits = dateText.replace(/\D/g, "");
  if (onlyDigits.length >= 8) {
    return `${onlyDigits.slice(0, 4)}-${onlyDigits.slice(4, 6)}-${onlyDigits.slice(6, 8)}`;
  }
  return "unknown";
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
      if (n >= 1 && n <= 99) result.add(n);
    }
  }
  return [...result];
};

const normalizeItem = (item: RawBaggageItem): BaggageSlot[] => {
  const flight = pickString(item, ["flightId", "flightNo", "airlineFlightNo", "airline"]);
  const typeOfFlight = pickString(item, ["typeOfFlight", "flightType"]).toUpperCase();

  const estimatedTime = pickString(item, [
    "estimatedDatetime",
    "estimatedDateTime",
    "estimatedTime",
    "scheduleDatetime",
    "scheduleDateTime",
    "std",
  ]);
  const scheduleTime = pickString(item, ["scheduleDatetime", "scheduleDateTime"]);
  /** 예정 도착이 있으면 그 시각으로 날짜·행(시간대)을 잡아, 변경 시 격자/목록이 따라가게 함 */
  const slotTime = estimatedTime.trim() || scheduleTime.trim() || estimatedTime || scheduleTime;
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
    date: toDateKey(slotTime),
    hour: toHour(slotTime),
    carousel,
    flight,
    typeOfFlight,
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

/** 정렬용: `estimatedTime`에서 그날 0시 기준 분(0–1439). 없거나 파싱 실패 시 맨 뒤로. */
export function getSortableMinuteOfDay(slot: BaggageSlot): number {
  const raw = (slot.estimatedTime ?? "").trim();
  if (!raw) return 24 * 60 + 999;
  const only = raw.replace(/\D/g, "");
  if (only.length >= 12) {
    const hh = Number(only.slice(8, 10));
    const mm = Number(only.slice(10, 12));
    if (Number.isFinite(hh) && hh >= 0 && hh < 48) {
      const h = ((Math.floor(hh) % 24) + 24) % 24;
      const m = Number.isFinite(mm) && mm >= 0 && mm < 60 ? Math.floor(mm) : 0;
      return h * 60 + m;
    }
  }
  const hm = raw.match(/(\d{1,2}):(\d{2})/);
  if (hm) {
    let h = Number(hm[1]);
    let m = Number(hm[2]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 24 * 60 + 998;
    h = ((Math.floor(h) % 24) + 24) % 24;
    m = Math.max(0, Math.min(59, Math.floor(m)));
    return h * 60 + m;
  }
  return 24 * 60 + 998;
}

export function compareSlotsByEstimatedArrival(a: BaggageSlot, b: BaggageSlot): number {
  const ta = getSortableMinuteOfDay(a);
  const tb = getSortableMinuteOfDay(b);
  if (ta !== tb) return ta - tb;
  if (a.carousel !== b.carousel) return a.carousel - b.carousel;
  return a.flight.localeCompare(b.flight);
}

/** `estimatedTime`(없으면 raw 스케줄) 기준으로 `date`·`hour` 행을 맞춤 — 병합·캐시 후에도 정렬·격자 행이 어긋나지 않게 */
export function alignSlotBucketToEstimated(slot: BaggageSlot): BaggageSlot {
  const scheduleTime = pickString(slot.raw, ["scheduleDatetime", "scheduleDateTime"]).trim();
  const slotTime = slot.estimatedTime.trim() || scheduleTime;
  if (!slotTime.trim()) return slot;
  return {
    ...slot,
    date: toDateKey(slotTime),
    hour: toHour(slotTime),
  };
}

/**
 * 같은 날짜·적재대·편명은 한 칸으로 본다. (`hour`는 제외 — 예정 시각이 바뀌면 행이 옮겨가야 하므로)
 * `typeOfFlight`는 키에 넣지 않는다 — 고정 행은 빈 값이라 API 행과 이중 표시되기 때문.
 * 저장된 강조 키(`…|시간대|…`)는 이전 버전과 달라질 수 있음.
 */
export function getSlotDedupeKey(slot: BaggageSlot): string {
  const flight = slot.flight.trim().toUpperCase().replace(/\s+/g, "");
  return `${slot.date}|${slot.carousel}|${flight}`;
}

const pickRicherSlot = (a: BaggageSlot, b: BaggageSlot): BaggageSlot => {
  const score = (s: BaggageSlot) => {
    let n = 0;
    if ((s.typeOfFlight ?? "").trim()) n += 4;
    if (s.note !== "fixedSchedule" && s.status !== "fixed") n += 2;
    n += Math.min(s.estimatedTime?.length ?? 0, 120) * 0.01;
    return n;
  };
  const d = score(b) - score(a);
  if (d !== 0) return d > 0 ? b : a;
  return (b.estimatedTime?.length ?? 0) >= (a.estimatedTime?.length ?? 0) ? b : a;
};

export function dedupeBaggageSlots(slots: BaggageSlot[]): BaggageSlot[] {
  const map = new Map<string, BaggageSlot>();
  for (const slot of slots) {
    const key = getSlotDedupeKey(slot);
    const prev = map.get(key);
    if (!prev) map.set(key, slot);
    else map.set(key, pickRicherSlot(prev, slot));
  }
  return [...map.values()].map(alignSlotBucketToEstimated).sort(compareSlotsByEstimatedArrival);
}

/** 같은 날짜 버킷 안에서 기존 목록과 신규 API 목록을 키 기준으로 합치고, 겹치면 더 신뢰할 행을 남긴다. */
export function mergeSlotsForDate(date: string, existing: BaggageSlot[], incoming: BaggageSlot[]): BaggageSlot[] {
  const norm = (s: BaggageSlot): BaggageSlot => ({ ...s, date });
  const map = new Map<string, BaggageSlot>();
  for (const s of existing) {
    const sn = norm(s);
    map.set(getSlotDedupeKey(sn), sn);
  }
  for (const s of incoming) {
    const sn = norm(s);
    const k = getSlotDedupeKey(sn);
    const prev = map.get(k);
    if (!prev) map.set(k, sn);
    else map.set(k, pickRicherSlot(prev, sn));
  }
  return [...map.values()].map(alignSlotBucketToEstimated).sort(compareSlotsByEstimatedArrival);
}

export async function fetchBaggageSlots(): Promise<BaggageSlot[]> {
  const responses: Response[] = [];
  let lastError = "";

  for (const url of API_URLS) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) {
        responses.push(res);
        continue;
      }
      if (res.status === 429) {
        lastError = "API 호출 한도 초과(429)입니다. 잠시 후 다시 시도해 주세요.";
      } else {
        lastError = `API 요청 실패 (${res.status})`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : "요청 실패";
    }
  }
  if (responses.length === 0) throw new Error(lastError || "API 요청 실패");

  const allSlots: BaggageSlot[] = [];
  for (const response of responses) {
    const json = await response.json();
    const itemsNode = json?.response?.body?.items;
    const items: unknown[] = Array.isArray(itemsNode)
      ? itemsNode
      : Array.isArray(itemsNode?.item)
      ? itemsNode.item
      : [];
    allSlots.push(...items.flatMap((item) => normalizeItem(item as RawBaggageItem)));
  }

  return dedupeBaggageSlots(allSlots);
}
