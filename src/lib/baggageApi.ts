import { BaggageSlot, RawBaggageItem } from "../types";

/** `BX165 / NRT / NRT` 등 연속 동일 토큰 제거 — 표시·검색·중복 키 정리 */
export function sanitizeFlightDisplay(flight: string): string {
  const parts = flight
    .trim()
    .split(/\s*\/\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const u = p.toUpperCase();
    if (out.length && out[out.length - 1].toUpperCase() === u) continue;
    out.push(p);
  }
  return out.join(" / ").trim();
}

const pickString = (obj: RawBaggageItem, keys: string[]): string => {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    /** 공공데이터 JSON이 숫자만 줄 때(YYYYMMDDHHmm) */
    if (typeof value === "number" && Number.isFinite(value)) {
      const s = String(Math.trunc(value));
      if (s.replace(/\D/g, "").length >= 8) return s;
    }
  }
  return "";
};

const SEOUL_TZ = "Asia/Seoul";

/** 순간(UTC 등) → 서울 달력·시·분 */
const formatInstantToSeoulWall = (inst: Date): { dateKey: string; hh: number; mm: number } => {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(inst);
  const g = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  const y = g("year");
  const mo = g("month");
  const da = g("day");
  const hs = g("hour");
  const ms = g("minute");
  const h = Number(hs);
  const m = Number(ms);
  if (!y || !mo || !da || !Number.isFinite(h) || !Number.isFinite(m)) {
    return { dateKey: "unknown", hh: 0, mm: 0 };
  }
  return {
    dateKey: `${y}-${mo}-${da}`,
    hh: ((Math.floor(h) % 24) + 24) % 24,
    mm: Math.max(0, Math.min(59, Math.floor(m))),
  };
};

/**
 * API 시각 문자열 → 서울 기준 날짜·시·분.
 * - `YYYYMMDDHHmm…` 연속 숫자(공공데이터): KST 달력으로 그대로 해석
 * - ISO·Z·오프셋: Instant로 파싱 후 서울로 변환 (UTC로만 오는 값에서 23시가 어긋나는 문제 완화)
 */
export function parseSeoulWallClock(raw: string): { dateKey: string; hh: number; mm: number } | null {
  const t = raw.trim();
  if (!t) return null;

  const digits = t.replace(/\D/g, "");
  /** YYYYMMDDHH / YYYYMMDDHHmm / YYYYMMDDHHmmss… — 앞 14자리만 사용(초 이하 무시) */
  if (/^\d+$/.test(digits) && digits.length >= 10) {
    const y = digits.slice(0, 4);
    const mo = digits.slice(4, 6);
    const da = digits.slice(6, 8);
    const hh = Number(digits.slice(8, 10));
    const mm = digits.length >= 12 ? Number(digits.slice(10, 12)) : 0;
    const monthNum = Number(mo);
    const dayNum = Number(da);
    if (
      !Number.isFinite(monthNum) ||
      monthNum < 1 ||
      monthNum > 12 ||
      !Number.isFinite(dayNum) ||
      dayNum < 1 ||
      dayNum > 31 ||
      !Number.isFinite(hh) ||
      !Number.isFinite(mm)
    ) {
      return null;
    }
    return {
      dateKey: `${y}-${mo}-${da}`,
      hh: ((Math.floor(hh) % 24) + 24) % 24,
      mm: Math.max(0, Math.min(59, Math.floor(mm))),
    };
  }

  const inst = new Date(t);
  if (!Number.isNaN(inst.getTime())) {
    return formatInstantToSeoulWall(inst);
  }

  const hm = t.match(/(\d{1,2}):(\d{2})/);
  if (hm && digits.length >= 8) {
    let h = Number(hm[1]);
    const m = Number(hm[2]);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      h = ((Math.floor(h) % 24) + 24) % 24;
      const dateKey = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
      return { dateKey, hh: h, mm: Math.max(0, Math.min(59, Math.floor(m))) };
    }
  }

  if (digits.length >= 8) {
    const dateKey = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    const hh = digits.length >= 10 ? Number(digits.slice(8, 10)) : 0;
    if (Number.isFinite(hh)) return { dateKey, hh: ((Math.floor(hh) % 24) + 24) % 24, mm: 0 };
  }

  if (hm) {
    let h = Number(hm[1]);
    const m = Number(hm[2]);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      h = ((Math.floor(h) % 24) + 24) % 24;
      return { dateKey: "unknown", hh: h, mm: Math.max(0, Math.min(59, Math.floor(m))) };
    }
  }

  return null;
}

/** `YYYY-M-D` + 시·분 → UTC ms (한국 벽시각 +09:00 고정, DST 없음) */
function seoulDateWallToUtcMs(dateKey: string, hh: number, mm: number): number | null {
  const p = dateKey.split("-");
  if (p.length !== 3) return null;
  const y = Number(p[0]);
  const mo = Number(p[1]);
  const da = Number(p[2]);
  if (![y, mo, da].every(Number.isFinite)) return null;
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  const h = ((Math.floor(hh) % 24) + 24) % 24;
  const m = Math.max(0, Math.min(59, Math.floor(mm)));
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * 첫·마지막 벨트 시각 문자열 사이(분). 달력이 바뀌거나 하루 이상 벌어져도 `+1440` 한 번이 아니라 실제 시각 차이로 계산.
 */
export function diffMinutesBaggageFirstLast(firstWallRaw: string, lastWallRaw: string): number | null {
  const a = parseSeoulWallClock(firstWallRaw.trim());
  const b = parseSeoulWallClock(lastWallRaw.trim());
  if (!a || !b) return null;
  if (a.dateKey === "unknown" || b.dateKey === "unknown") return null;
  const ta = seoulDateWallToUtcMs(a.dateKey, a.hh, a.mm);
  const tb = seoulDateWallToUtcMs(b.dateKey, b.hh, b.mm);
  if (ta === null || tb === null) return null;
  const diff = Math.round((tb - ta) / 60_000);
  if (!Number.isFinite(diff) || diff < 0) return null;
  return diff;
}

const bucketDateHour = (raw: string): { dateKey: string; hour: string } => {
  const w = parseSeoulWallClock(raw);
  if (!w) return { dateKey: "unknown", hour: "00:00" };
  return { dateKey: w.dateKey, hour: `${String(w.hh).padStart(2, "0")}:00` };
};

/**
 * 날짜 버킷은 예정(schedule) 날짜를 우선 신뢰.
 * 일부 API 응답에서 estimatedDatetime의 날짜가 실제 운항일과 어긋나는 경우가 있어
 * `24일/25일` 같은 날짜 탭이 사라지는 문제를 막는다.
 */
const pickBucketTimeWithStableDate = (scheduleTime: string, estimatedOnly: string): string => {
  const s = scheduleTime.trim();
  const e = estimatedOnly.trim();
  if (!s && !e) return "";
  if (!e) return s;
  if (!s) return e;

  const sw = parseSeoulWallClock(s);
  const ew = parseSeoulWallClock(e);
  if (sw?.dateKey && sw.dateKey !== "unknown") {
    if (!ew || ew.dateKey === "unknown" || ew.dateKey !== sw.dateKey) return s;
  }
  return e;
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
  const flight = sanitizeFlightDisplay(pickString(item, ["flightId", "flightNo", "airlineFlightNo", "airline"]));
  const typeOfFlight = pickString(item, ["typeOfFlight", "flightType"]).toUpperCase();

  /** 표시·정렬용 (예정 우선) */
  const estimatedOnly = pickString(item, ["estimatedDatetime", "estimatedDateTime", "estimatedTime"]);
  /** 격자 날짜·시간 행: 화면에 보이는 표시 시각(displayTime) 기준으로 맞춘다. */
  const scheduleTime = pickString(item, ["scheduleDatetime", "scheduleDateTime", "std"]);
  const displayTime = estimatedOnly.trim() || scheduleTime.trim();
  const bucketTime = pickBucketTimeWithStableDate(scheduleTime, estimatedOnly) || displayTime;
  const { dateKey, hour } = bucketDateHour(bucketTime);
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
    date: dateKey,
    hour,
    carousel,
    flight,
    typeOfFlight,
    estimatedTime: displayTime,
    status,
    pieces,
    note,
    raw: item,
  }));
};

export const buildHourRows = (): string[] => {
  return Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
};

/** 정렬용: `estimatedTime`(표시 시각)을 서울 기준 분(0–1439). 없거나 파싱 실패 시 맨 뒤로. */
export function getSortableMinuteOfDay(slot: BaggageSlot): number {
  const raw = (slot.estimatedTime ?? "").trim();
  if (!raw) return 24 * 60 + 999;
  const w = parseSeoulWallClock(raw);
  if (!w) return 24 * 60 + 998;
  return w.hh * 60 + w.mm;
}

export function compareSlotsByEstimatedArrival(a: BaggageSlot, b: BaggageSlot): number {
  const ta = getSortableMinuteOfDay(a);
  const tb = getSortableMinuteOfDay(b);
  if (ta !== tb) return ta - tb;
  if (a.carousel !== b.carousel) return a.carousel - b.carousel;
  return a.flight.localeCompare(b.flight);
}

/** 격자 `date`·`hour` 행은 표시 시각 우선으로 맞춤 — 병합·캐시 후에도 `normalizeItem`과 동일 규칙 */
export function alignSlotBucketToEstimated(slot: BaggageSlot): BaggageSlot {
  const scheduleTime = pickString(slot.raw, ["scheduleDatetime", "scheduleDateTime", "std"]).trim();
  const estimatedOnly = pickString(slot.raw, ["estimatedDatetime", "estimatedDateTime", "estimatedTime"]).trim();
  const displayTime = slot.estimatedTime.trim() || estimatedOnly || scheduleTime;
  const bucketTime = pickBucketTimeWithStableDate(scheduleTime, estimatedOnly) || displayTime;
  if (!bucketTime.trim()) return slot;
  const w = parseSeoulWallClock(bucketTime);
  if (!w) return slot;
  const hour = `${String(w.hh).padStart(2, "0")}:00`;
  /** `timeStand` 등으로 달력을 못 잡으면 기존 `date`(날짜 키·`*` 플레이스홀더) 유지 */
  const dateKey = w.dateKey !== "unknown" ? w.dateKey : slot.date;
  return {
    ...slot,
    date: dateKey,
    hour,
  };
}

/**
 * `BX165 / NRT` 와 `BX165` 를 동일 편으로 보아 격자·병합에서 한 칸으로 묶는다.
 * (첫 `/` 앞의 편명 부분만 사용. 코드셰어 `KE / OZ` 형은 앞 세그먼트 기준)
 */
export function canonicalFlightDedupeKey(flight: string): string {
  const cleaned = sanitizeFlightDisplay(flight);
  const t = cleaned.trim().toUpperCase();
  if (!t) return "";
  const head = t.split(/\s*\/\s*/)[0]?.replace(/\s+/g, "") ?? "";
  return head;
}

/** I·D = 도착/국내 도착 등 — 겹치는 줄 중 반드시 이쪽을 남김 */
const isArrivalLikeType = (s: BaggageSlot): boolean => {
  const t = (s.typeOfFlight ?? "").trim().toUpperCase();
  return t === "I" || t === "D";
};

const rawBagFirst = (raw: RawBaggageItem): string =>
  pickString(raw, ["bagFirstTime", "bagfirstTime"]);
const rawBagLast = (raw: RawBaggageItem): string => pickString(raw, ["bagLastTime", "baglastTime"]);

const hasCompleteBaggageTimesRaw = (raw: RawBaggageItem): boolean =>
  Boolean(rawBagFirst(raw) && rawBagLast(raw));

/** YYYYMMDDHHmm — 값이 큰 쪽을 최근 스냅샷으로 간주(공공데이터 갱신 반영) */
const baggageWallClock12 = (value: string): number => {
  const d = value.replace(/\D/g, "");
  if (d.length >= 12) return Number.parseInt(d.slice(0, 12), 10) || 0;
  if (d.length >= 10) return Number.parseInt(d.slice(0, 10), 10) || 0;
  return 0;
};

const pickRicherBagTime = (a: string, b: string): string => {
  if (!b.trim()) return a;
  if (!a.trim()) return b;
  return baggageWallClock12(b) >= baggageWallClock12(a) ? b : a;
};

/**
 * 병합·중복 제거에서 한 줄만 남길 때, 다른 줄에만 있던 수화물 처리 시각이 버리지 않게 `raw`만 합침.
 */
const mergeRawBaggageProcessingTimes = (base: RawBaggageItem, extra: RawBaggageItem): RawBaggageItem => {
  const fB = rawBagFirst(base);
  const fE = rawBagFirst(extra);
  const lB = rawBagLast(base);
  const lE = rawBagLast(extra);
  const f = pickRicherBagTime(fB, fE);
  const l = pickRicherBagTime(lB, lE);
  if (!f && !l) return base;
  const out: RawBaggageItem = { ...base };
  if (f) {
    out.bagFirstTime = f;
    out.bagfirstTime = f;
  }
  if (l) {
    out.bagLastTime = l;
    out.baglastTime = l;
  }
  return out;
};

const withMergedRawBaggageTimes = (winner: BaggageSlot, loser: BaggageSlot): BaggageSlot => ({
  ...winner,
  raw: mergeRawBaggageProcessingTimes(winner.raw, loser.raw),
});

/** tie-break: API·실데이터 우선, 그다음 예정 길이 */
const duplicateFlightPickScore = (s: BaggageSlot): number => {
  const t = (s.typeOfFlight ?? "").trim().toUpperCase();
  let n = 0;
  if (t === "O") n += 400;
  else if (t) n += 250;
  if (s.note !== "fixedSchedule") n += 500;
  if (s.status !== "fixed") n += 200;
  /** 같은 편명으로 한 줄로 묶일 때 처리 시각이 있는 행을 선호(완전·부분) */
  if (hasCompleteBaggageTimesRaw(s.raw)) n += 150;
  else if (rawBagFirst(s.raw) || rawBagLast(s.raw)) n += 45;
  n += Math.min((s.estimatedTime ?? "").length, 150);
  return n;
};

const pickSingleSlotFromDuplicateGroup = (group: BaggageSlot[]): BaggageSlot =>
  [...group].sort((a, b) => {
    const aa = isArrivalLikeType(a) ? 1 : 0;
    const bb = isArrivalLikeType(b) ? 1 : 0;
    if (aa !== bb) return bb - aa;
    return duplicateFlightPickScore(b) - duplicateFlightPickScore(a);
  })[0]!;

/** 같은 편이 `unknown`·정상 날짜 등으로 갈라져도 승자 행 날짜를 맞춤 */
const resolveGroupDate = (group: BaggageSlot[]): string => {
  const concrete = group.find((s) => s.date && s.date !== "unknown")?.date;
  return concrete ?? group[0]!.date;
};

/**
 * 동일 편(적재대 무시)이 여러 줄이면 하나만 남김. 호출부 배치는 **하루치·한 날짜** 단위(편명만으로 그룹핑 안전).
 */
export function collapseDuplicateFlightsPreferClassified(slots: BaggageSlot[]): BaggageSlot[] {
  const noFlightKey: BaggageSlot[] = [];
  const groups = new Map<string, BaggageSlot[]>();
  for (const s of slots) {
    const fk = canonicalFlightDedupeKey(s.flight);
    if (!fk) {
      noFlightKey.push(s);
      continue;
    }
    const g = groups.get(fk) ?? [];
    g.push(s);
    groups.set(fk, g);
  }
  const out: BaggageSlot[] = [...noFlightKey];
  for (const g of groups.values()) {
    if (g.length === 1) {
      out.push(g[0]!);
      continue;
    }
    let w = pickSingleSlotFromDuplicateGroup(g);
    for (const s of g) {
      if (s !== w) w = withMergedRawBaggageTimes(w, s);
    }
    const d = resolveGroupDate(g);
    if (d && w.date !== d) w = { ...w, date: d };
    out.push(w);
  }
  return out.sort(compareSlotsByEstimatedArrival);
}

/**
 * 같은 날짜·적재대·편명은 한 칸으로 본다. (`hour`는 제외 — 예정 시각이 바뀌면 행이 옮겨가야 하므로)
 * `typeOfFlight`는 키에 넣지 않는다 — 고정 행은 빈 값이라 API 행과 이중 표시되기 때문.
 * 저장된 강조 키(`…|시간대|…`)는 이전 버전과 달라질 수 있음.
 */
export function getSlotDedupeKey(slot: BaggageSlot): string {
  const flight = canonicalFlightDedupeKey(slot.flight);
  return `${slot.date}|${slot.carousel}|${flight}`;
}

const hourBucketLead = (h: string): number => {
  const m = (h ?? "").trim().match(/^(\d{1,2})/);
  if (!m) return -1;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : -1;
};

/** 자정 넘김 버킷 보정은 API에 도착(I/D)이 있으면 적용하지 않음 — 도착 행을 우선 */
const preferFixedOverApiMidnightRow = (fixed: BaggageSlot, api: BaggageSlot): BaggageSlot | null => {
  if (fixed.note !== "fixedSchedule" || api.note === "fixedSchedule") return null;
  if (isArrivalLikeType(api)) return null;
  const fh = hourBucketLead(fixed.hour);
  const ah = hourBucketLead(api.hour);
  if (fh >= 22 && ah >= 0 && ah <= 5) return fixed;
  return null;
};

const pickRicherSlot = (a: BaggageSlot, b: BaggageSlot): BaggageSlot => {
  let winner: BaggageSlot;
  const aAr = isArrivalLikeType(a);
  const bAr = isArrivalLikeType(b);
  if (aAr && !bAr) winner = a;
  else if (!aAr && bAr) winner = b;
  else {
    const midA = preferFixedOverApiMidnightRow(a, b);
    if (midA) winner = midA;
    else {
      const midB = preferFixedOverApiMidnightRow(b, a);
      if (midB) winner = midB;
      else {
        const score = (s: BaggageSlot) => {
          let n = 0;
          if ((s.typeOfFlight ?? "").trim()) n += 4;
          if (s.note !== "fixedSchedule" && s.status !== "fixed") n += 2;
          if (hasCompleteBaggageTimesRaw(s.raw)) n += 3;
          else if (rawBagFirst(s.raw) || rawBagLast(s.raw)) n += 1;
          n += Math.min(s.estimatedTime?.length ?? 0, 120) * 0.01;
          return n;
        };
        const d = score(b) - score(a);
        if (d !== 0) winner = d > 0 ? b : a;
        else {
          const lenDiff = (b.flight?.length ?? 0) - (a.flight?.length ?? 0);
          if (lenDiff !== 0) winner = lenDiff > 0 ? b : a;
          else winner = (b.estimatedTime?.length ?? 0) >= (a.estimatedTime?.length ?? 0) ? b : a;
        }
      }
    }
  }
  const loser = winner === a ? b : a;
  return withMergedRawBaggageTimes(winner, loser);
};

export function dedupeBaggageSlots(slots: BaggageSlot[]): BaggageSlot[] {
  const map = new Map<string, BaggageSlot>();
  for (const slot of slots) {
    const key = getSlotDedupeKey(slot);
    const prev = map.get(key);
    if (!prev) map.set(key, slot);
    else map.set(key, pickRicherSlot(prev, slot));
  }
  const merged = [...map.values()].map(alignSlotBucketToEstimated).sort(compareSlotsByEstimatedArrival);
  return collapseDuplicateFlightsPreferClassified(merged);
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
  const merged = [...map.values()].map(alignSlotBucketToEstimated).sort(compareSlotsByEstimatedArrival);
  return collapseDuplicateFlightsPreferClassified(merged);
}

const extractItemsArray = (json: unknown): unknown[] => {
  const itemsNode = (json as { response?: { body?: { items?: unknown } } })?.response?.body?.items;
  if (Array.isArray(itemsNode)) return itemsNode;
  if (Array.isArray((itemsNode as { item?: unknown[] })?.item)) return (itemsNode as { item: unknown[] }).item;
  return [];
};

const extractTotalCount = (json: unknown): number => {
  const raw = (json as { response?: { body?: { totalCount?: unknown } } })?.response?.body?.totalCount;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

const DEV_SEARCH_DAYS = [0, 1, 2] as const;
const DEV_ROWS_PER_PAGE = 1000;
const DEV_MAX_PAGE_PER_DAY = 15;

export async function fetchBaggageSlots(): Promise<BaggageSlot[]> {
  const allSlots: BaggageSlot[] = [];
  let lastError = "";
  const parseErrorDetail = (text: string): string => {
    if (!text.trim()) return "";
    try {
      const parsed = JSON.parse(text) as {
        message?: string;
        response?: { header?: { resultMsg?: string } };
      };
      return parsed.message?.trim() ?? parsed.response?.header?.resultMsg?.trim() ?? text.trim().slice(0, 120);
    } catch {
      return text.trim().slice(0, 120);
    }
  };

  const url = `/api/baggage-arrivals?type=json`;
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      let detail = "";
      try {
        const text = await res.text();
        if (text.trim()) {
          try {
            const parsed = JSON.parse(text) as {
              message?: string;
              response?: { header?: { resultMsg?: string } };
            };
            detail =
              parsed.message?.trim() ??
              parsed.response?.header?.resultMsg?.trim() ??
              text.trim().slice(0, 120);
          } catch {
            detail = text.trim().slice(0, 120);
          }
        }
      } catch {
        // ignore body read failure
      }
      if (res.status === 429) {
        lastError = "API 호출 한도 초과(429)입니다. 잠시 후 다시 시도해 주세요.";
      } else if (res.status === 503) {
        lastError = detail
          ? `API 요청 실패 (503): ${detail}`
          : "API 요청 실패 (503): 서버 설정 문제일 수 있습니다. DATA_GO_KR_SERVICE_KEY를 확인해 주세요.";
      } else {
        lastError = detail ? `API 요청 실패 (${res.status}): ${detail}` : `API 요청 실패 (${res.status})`;
      }
      throw new Error(lastError || "API 요청 실패");
    }
    const json = await res.json();
    let items = extractItemsArray(json);
    const totalCount = extractTotalCount(json);

    // dev 프록시가 서버 스냅샷 대신 원본 1페이지만 줄 때(24일만 보이는 문제) 보강 수집.
    const needsFallbackFanout = totalCount > items.length && items.length <= DEV_ROWS_PER_PAGE;
    if (needsFallbackFanout) {
      const fanoutItems: unknown[] = [];
      for (const searchDay of DEV_SEARCH_DAYS) {
        for (let pageNo = 1; pageNo <= DEV_MAX_PAGE_PER_DAY; pageNo++) {
          const pageUrl = `/api/baggage-arrivals?type=json&numOfRows=${DEV_ROWS_PER_PAGE}&pageNo=${pageNo}&searchDay=${searchDay}`;
          const pageRes = await fetch(pageUrl, { method: "GET" });
          if (!pageRes.ok) {
            const t = await pageRes.text();
            const detail = parseErrorDetail(t);
            if (pageRes.status === 429) {
              throw new Error("API 호출 한도 초과(429)입니다. 잠시 후 다시 시도해 주세요.");
            }
            throw new Error(detail || `API 요청 실패 (${pageRes.status})`);
          }
          const pageJson = await pageRes.json();
          const pageItems = extractItemsArray(pageJson);
          fanoutItems.push(...pageItems);
          if (pageItems.length < DEV_ROWS_PER_PAGE) break;
        }
      }
      items = fanoutItems;
    }

    allSlots.push(...items.flatMap((item) => normalizeItem(item as RawBaggageItem)));
  } catch (err) {
    if (!lastError) lastError = err instanceof Error ? err.message : "요청 실패";
    throw new Error(lastError || "API 요청 실패");
  }
  /** 날짜가 섞인 채로 편당 병합하면 다른 날 항공편이 한 줄로 합쳐짐 → 날짜별로 나눔 */
  const byDate = new Map<string, BaggageSlot[]>();
  for (const s of allSlots) {
    const d = s.date || "unknown";
    const list = byDate.get(d) ?? [];
    list.push(s);
    byDate.set(d, list);
  }
  const merged: BaggageSlot[] = [];
  for (const list of byDate.values()) {
    merged.push(...dedupeBaggageSlots(list));
  }
  return merged;
}
