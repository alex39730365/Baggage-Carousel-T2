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

const compactTimeKey = (raw: string): string => raw.replace(/\D/g, "").slice(0, 12);

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

/** 공공데이터·게이트웨이별 필드명 — `normalizeItem`·병합·변경 감지·UI에서 동일 순서로 사용 */
export const RAW_FLIGHT_KEYS = [
  "flightId",
  "flightNo",
  "airlineFlightNo",
  "flight",
  "fltId",
  "fltNo",
  "airline",
] as const;

export const RAW_TYPE_OF_FLIGHT_KEYS = ["typeOfFlight", "flightType", "ioType", "domIntType"] as const;

export const RAW_ESTIMATED_TIME_KEYS = [
  "estimatedDatetime",
  "estimatedDateTime",
  "estimatedTime",
  "eta",
  "estmDttm",
  "estimatedDT",
  "estimatedDttm",
] as const;

export const RAW_SCHEDULE_TIME_KEYS = [
  "scheduleDatetime",
  "scheduleDateTime",
  "std",
  "scheduledDatetime",
  "schedDT",
  "scheduledDttm",
] as const;

export const RAW_BAG_FIRST_TIME_KEYS = [
  "bagFirstTime",
  "bagfirstTime",
  "firstBaggageTime",
  "firstBagTime",
  "baggageFirstTime",
  "fdcsFirstBagTime",
] as const;

export const RAW_BAG_LAST_TIME_KEYS = [
  "bagLastTime",
  "baglastTime",
  "lastBaggageTime",
  "lastBagTime",
  "baggageLastTime",
  "fdcsLastBagTime",
] as const;

export const RAW_LATERAL_KEYS = [
  "lateral1",
  "lateralNo",
  "lateralNum",
  "lateral1No",
  "carouselNo",
  "carousel",
  "bagCarouselId",
  "assignedCarousel",
  "claimDeskNo",
  "baggageClaimDesk",
] as const;

export const RAW_LATERAL2_KEYS = ["lateral2", "bagCarouselId2", "lateral2No"] as const;

export const RAW_STATUS_KEYS = [
  "lateral1Status",
  "lateralStatus",
  "status",
  "baggageStatus",
  "bagRemark",
  "claimStatus",
] as const;

export const RAW_PIECES_KEYS = ["baggagePieces", "pc", "pieces", "cargoCount", "bagPc", "bagPiece"] as const;

export const RAW_NOTE_KEYS = ["remark", "note", "specialRemark", "rmk"] as const;

export const RAW_ACTUAL_ARRIVAL_KEYS = [
  "landingDatetime",
  "landingDateTime",
  "actualDatetime",
  "actualDateTime",
  "actualTime",
  "ata",
  "arrivalDatetime",
  "arrivalDateTime",
  "ataDatetime",
  "ataDateTime",
  "landingDttm",
  "arrDttm",
] as const;

export const RAW_STAND_KEYS = [
  "fstandPosition",
  "gateNumber",
  "stand",
  "airportStand",
  "boardingGate",
  "parkingStand",
] as const;

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

const normalizeWallHourWithRollover = (
  dateKey: string,
  hh: number,
  mm: number
): { dateKey: string; hh: number; mm: number } => {
  const h = ((Math.floor(hh) % 24) + 24) % 24;
  const m = Math.max(0, Math.min(59, Math.floor(mm)));
  const extraDays = Math.floor((Math.floor(hh) - h) / 24);
  if (extraDays === 0 || dateKey === "unknown") {
    return { dateKey, hh: h, mm: m };
  }
  const baseMs = seoulDateWallToUtcMs(dateKey, 12, 0);
  if (baseMs === null) return { dateKey, hh: h, mm: m };
  const shifted = new Date(baseMs + extraDays * 86_400_000);
  const wall = formatInstantToSeoulWall(shifted);
  return { dateKey: wall.dateKey, hh: h, mm: m };
};

/**
 * API 시각 문자열 → 서울 기준 날짜·시·분.
 * - `YYYYMMDDHHmm…` **문자열이 숫자만**일 때: 공공데이터 KST 달력으로 해석
 * - `YYYY-MM-DDTHH:mm(:ss)?` **타임존 없음**: 브라우저 로컬이 아니라 **서울 벽시각**으로 해석
 * - `Z`·`±HH:mm` 오프셋·`T` 포함 ISO: Instant로 파싱 후 서울로 변환
 */
export function parseSeoulWallClock(raw: string): { dateKey: string; hh: number; mm: number } | null {
  const t = raw.trim();
  if (!t) return null;

  const wallCompact = t.replace(/\s/g, "");
  /** ISO를 숫자만 잘라 첫 분기에 넣으면 Z/오프셋이 사라져 시각이 틀어짐 → “숫자만”인 경우만 compact */
  if (/^\d{10,14}$/.test(wallCompact)) {
    const digits = wallCompact.slice(0, 14);
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
    return normalizeWallHourWithRollover(`${y}-${mo}-${da}`, hh, mm);
  }

  const digits = t.replace(/\D/g, "");

  /** 타임존 없는 ISO 형 — `new Date`는 로컬로 해석하므로 서울 벽시각으로 고정 */
  const hasExplicitZone = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(t);
  if (!hasExplicitZone) {
    const naked = t.match(
      /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,3})?$/
    );
    if (naked) {
      const y = naked[1]!;
      const mo = naked[2]!;
      const da = naked[3]!;
      const hh = Number(naked[4]!);
      const mm = Number(naked[5]!);
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
      return normalizeWallHourWithRollover(`${y}-${mo}-${da}`, hh, mm);
    }
  }

  const inst = new Date(t);
  if (!Number.isNaN(inst.getTime())) {
    return formatInstantToSeoulWall(inst);
  }

  const hm = t.match(/(\d{1,2}):(\d{2})/);
  if (hm && digits.length >= 8) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      const dateKey = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
      return normalizeWallHourWithRollover(dateKey, h, m);
    }
  }

  if (digits.length >= 8) {
    const dateKey = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    const hh = digits.length >= 10 ? Number(digits.slice(8, 10)) : 0;
    if (Number.isFinite(hh)) return normalizeWallHourWithRollover(dateKey, hh, 0);
  }

  if (hm) {
    const h = Number(hm[1]);
    const m = Number(hm[2]);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      return normalizeWallHourWithRollover("unknown", h, m);
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

function slotDateToDateKey(slotDate: string): string | null {
  const t = slotDate.trim();
  const digits = t.replace(/\D/g, "");
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/**
 * 도착(ATA)부터 마지막 수하물(L)까지 경과(분). 첫 수하물(F)은 소요 계산에 사용하지 않음.
 * 도착 시각에 날짜가 없으면 L의 날짜 또는 `slotDate`로 맞춘다.
 */
export function diffMinutesArrivalToLastBaggage(
  arrivalRaw: string,
  lastBagRaw: string,
  slotDate: string
): number | null {
  const lastTrim = lastBagRaw.trim();
  if (!lastTrim) return null;
  const lastW = parseSeoulWallClock(lastTrim);
  if (!lastW) return null;

  const arrTrim = arrivalRaw.trim();
  if (!arrTrim) return null;
  const arrW = parseSeoulWallClock(arrTrim);
  if (arrW && arrW.dateKey !== "unknown") {
    return diffMinutesBaggageFirstLast(arrTrim, lastTrim);
  }

  const hm = arrTrim.match(/(\d{1,2}):(\d{2})/);
  if (!hm) return null;
  let hh = Number(hm[1]);
  let mm = Number(hm[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  hh = ((Math.floor(hh) % 24) + 24) % 24;
  mm = Math.max(0, Math.min(59, Math.floor(mm)));

  const dateKey =
    lastW.dateKey !== "unknown" ? lastW.dateKey : slotDateToDateKey(slotDate);
  if (!dateKey) return null;
  const p = dateKey.split("-");
  if (p.length !== 3) return null;
  const ymdCompact = `${p[0]}${p[1]}${p[2]}`;
  const arrivalSynthetic = `${ymdCompact}${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}`;
  return diffMinutesBaggageFirstLast(arrivalSynthetic, lastTrim);
}

/** 마지막 수하물(L) 시각을 UTC ms로. 없거나 파싱 불가면 null. */
export function getBagLastTimeUtcMs(slot: BaggageSlot): number | null {
  const t = pickString(slot.raw, [...RAW_BAG_LAST_TIME_KEYS]).trim();
  if (!t) return null;
  const w = parseSeoulWallClock(t);
  if (!w) return null;
  const dateKey = w.dateKey !== "unknown" ? w.dateKey : slotDateToDateKey(slot.date);
  if (!dateKey) return null;
  return seoulDateWallToUtcMs(dateKey, w.hh, w.mm);
}

/** `nowMs`가 L 시각 이상이면 true (L 데이터가 있을 때만). */
export function isBagLastTimePassed(slot: BaggageSlot, nowMs: number): boolean {
  const ms = getBagLastTimeUtcMs(slot);
  if (ms === null) return false;
  return nowMs >= ms;
}

const bucketDateHour = (raw: string): { dateKey: string; hour: string } => {
  const w = parseSeoulWallClock(raw);
  if (!w) return { dateKey: "unknown", hour: "00:00" };
  return { dateKey: w.dateKey, hour: `${String(w.hh).padStart(2, "0")}:00` };
};

/**
 * 자정 전후(red-eye) 및 단기 지연로 인해 예정/예측 날짜가 달라지는 경우,
 * 예측(estimated) 시각이 실제 운항에 더 가깝다면 예측 시각을 버킷 기준으로 사용.
 * 예정 시각이 새벽/자정을 넘어선 경우(밤 18시~익일 07시 범위 내)에 한정해 적용.
 */
const LATE_NIGHT_SCHEDULE_HOUR = 18;
const EARLY_MORNING_ESTIMATED_HOUR_CUTOFF = 7; // 00:00 ~ 06:59
const MAX_CROSS_MIDNIGHT_DELAY_MS = 8 * 60 * 60 * 1000;

export const pickBucketTimeWithStableDate = (scheduleTime: string, estimatedOnly: string): string => {
  const s = scheduleTime.trim();
  const e = estimatedOnly.trim();
  if (!s && !e) return "";
  if (!e) return s;
  if (!s) return e;

  const sw = parseSeoulWallClock(s);
  const ew = parseSeoulWallClock(e);
  if (!sw || sw.dateKey === "unknown") return e;
  if (!ew || ew.dateKey === "unknown") return s;

  // 자정 전후 지연일 때는 예측 시간을 버킷에 반영
  if (ew.dateKey !== sw.dateKey) {
    const sMs = seoulDateWallToUtcMs(sw.dateKey, sw.hh, sw.mm);
    const eMs = seoulDateWallToUtcMs(ew.dateKey, ew.hh, ew.mm);
    if (
      sMs !== null &&
      eMs !== null &&
      eMs > sMs &&
      eMs - sMs <= MAX_CROSS_MIDNIGHT_DELAY_MS &&
      sw.hh >= LATE_NIGHT_SCHEDULE_HOUR &&
      ew.hh < EARLY_MORNING_ESTIMATED_HOUR_CUTOFF
    ) {
      return e;
    }
    return s;
  }

  return e;
};

const parseCarouselNumbers = (item: RawBaggageItem): number[] => {
  const texts = [pickString(item, [...RAW_LATERAL_KEYS]), pickString(item, [...RAW_LATERAL2_KEYS])].filter(Boolean);

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
  const flight = sanitizeFlightDisplay(pickString(item, [...RAW_FLIGHT_KEYS]));
  const typeOfFlight = pickString(item, [...RAW_TYPE_OF_FLIGHT_KEYS]).toUpperCase();

  /** 표시·정렬용 (예정 우선) */
  const estimatedOnly = pickString(item, [...RAW_ESTIMATED_TIME_KEYS]);
  /** 격자 날짜·시간 행: 화면에 보이는 표시 시각(displayTime) 기준으로 맞춘다. */
  const scheduleTime = pickString(item, [...RAW_SCHEDULE_TIME_KEYS]);
  const displayTime = estimatedOnly.trim() || scheduleTime.trim();
  const bucketTime = pickBucketTimeWithStableDate(scheduleTime, estimatedOnly) || displayTime;
  const { dateKey, hour } = bucketDateHour(bucketTime);
  const status = pickString(item, [...RAW_STATUS_KEYS]);
  const pieces = pickString(item, [...RAW_PIECES_KEYS]);
  const note = pickString(item, [...RAW_NOTE_KEYS]);

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

/** 슬롯의 표시 시각(estimatedTime)을 UTC ms로. 파싱 불가 시 null. */
export function getEstimatedTimeUtcMs(slot: BaggageSlot): number | null {
  const raw = (slot.estimatedTime ?? "").trim();
  if (!raw) return null;
  let w = parseSeoulWallClock(raw);
  if (!w) return null;
  if (w.dateKey === "unknown" && slot.date && slot.date !== "unknown") {
    const wall = parseSeoulWallClock(
      `${slot.date}T${String(w.hh).padStart(2, "0")}:${String(w.mm).padStart(2, "0")}`
    );
    if (wall) w = wall;
  }
  if (!w || w.dateKey === "unknown") return null;
  return seoulDateWallToUtcMs(w.dateKey, w.hh, w.mm);
}

/** 슬롯의 표시 시각이 nowMs로부터 몇 분 뒤(+) 또는 앞(-)인지. 파싱 불가 시 null. */
export function getEstimatedTimeMinutesFromNow(slot: BaggageSlot, nowMs: number): number | null {
  const ms = getEstimatedTimeUtcMs(slot);
  if (ms === null) return null;
  return Math.round((ms - nowMs) / 60_000);
}

export const DEFAULT_MAX_PAST_HOURS = 24;

/** nowMs 기준 maxPastHours 이상 지난 과거 데이터를 제외. 미래·파싱 불가는 유지. */
export function filterSlotsByRecency(
  slots: BaggageSlot[],
  nowMs: number,
  maxPastHours: number = DEFAULT_MAX_PAST_HOURS
): BaggageSlot[] {
  const cutoff = nowMs - maxPastHours * 60 * 60 * 1000;
  return slots.filter((slot) => {
    const ms = getEstimatedTimeUtcMs(slot);
    if (ms === null) return true;
    return ms >= cutoff;
  });
}

/** 현재 시각 기준 미래 도착 예정 → 최근 도착 순으로 정렬. 파싱 불가는 맨 뒤. */
export function compareSlotsByTimeProximity(nowMs: number) {
  return (a: BaggageSlot, b: BaggageSlot): number => {
    const da = getEstimatedTimeMinutesFromNow(a, nowMs);
    const db = getEstimatedTimeMinutesFromNow(b, nowMs);
    if (da === null && db === null) return compareSlotsByEstimatedArrival(a, b);
    if (da === null) return 1;
    if (db === null) return -1;
    const futureA = da >= 0;
    const futureB = db >= 0;
    // 미래 항공편을 과거 항공편보다 먼저
    if (futureA && !futureB) return -1;
    if (!futureA && futureB) return 1;
    if (futureA) return da - db; // 미래: 빠른 도착 순
    return db - da; // 과거: 최근 도착 순
  };
}

/** 격자 `date`·`hour` 행은 표시 시각 우선으로 맞춤 — 병합·캐시 후에도 `normalizeItem`과 동일 규칙 */
export function alignSlotBucketToEstimated(slot: BaggageSlot): BaggageSlot {
  const scheduleTime = pickString(slot.raw, [...RAW_SCHEDULE_TIME_KEYS]).trim();
  const estimatedOnly = pickString(slot.raw, [...RAW_ESTIMATED_TIME_KEYS]).trim();
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

const rawBagFirst = (raw: RawBaggageItem): string => pickString(raw, [...RAW_BAG_FIRST_TIME_KEYS]);
const rawBagLast = (raw: RawBaggageItem): string => pickString(raw, [...RAW_BAG_LAST_TIME_KEYS]);

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
 * 병합·중복 제거에서 한 줄만 남길 때, 다른 줄에만 있던 수하물 처리 시각이 버리지 않게 `raw`만 합침.
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
 * 동일 편·적재대·표시 시각이 같은 여러 줄은 하나로 묶는다.
 * 호출부는 **하루치·한 날짜** 단위이므로 편명+시각+적재대 단위 그룹핑이 안전하다.
 */
export function collapseDuplicateFlightsPreferClassified(slots: BaggageSlot[]): BaggageSlot[] {
  const noFlightKey: BaggageSlot[] = [];
  const groups = new Map<string, BaggageSlot[]>();
  for (const s of slots) {
    const flight = canonicalFlightDedupeKey(s.flight);
    if (!flight) {
      noFlightKey.push(s);
      continue;
    }
    const timeKey = compactTimeKey(s.estimatedTime);
    const fk = `${flight}|${s.carousel}|${timeKey}`;
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
 * 같은 날짜·적재대·편명·표시 시각은 한 칸으로 본다. (`hour`는 제외 — 예정 시각이 바뀌면 행이 옮겨가야 하므로)
 * `typeOfFlight`는 키에 넣지 않는다 — 고정 행은 빈 값이라 API 행과 이중 표시되기 때문.
 * 저장된 강조 키(`…|시간대|…`)는 이전 버전과 달라질 수 있음.
 */
export function getSlotDedupeKey(slot: BaggageSlot): string {
  const flight = canonicalFlightDedupeKey(slot.flight);
  const timeKey = compactTimeKey(slot.estimatedTime);
  return `${slot.date}|${slot.carousel}|${flight}|${timeKey}`;
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

/**
 * 우선순위: `VITE_WORKER_API_URL`(Cloudflare Worker 프록시) → `VITE_BAGGAGE_ARRIVALS_URL`
 * (커스텀 게이트웨이) → 동일 출처 `/api/baggage-arrivals`(Vercel 함수, 폴백).
 *
 * Vercel 서버리스 함수는 공공데이터 서버 응답 지연 시 504로 실패하는 경우가 있어,
 * Cloudflare Worker 프록시(Edge 캐싱 포함)로 우선 라우팅한다.
 */
export function getBaggageArrivalsBaseUrl(): string {
  const worker = (import.meta.env.VITE_WORKER_API_URL ?? "").trim().replace(/\/$/, "");
  if (worker) return worker;
  const v = (import.meta.env.VITE_BAGGAGE_ARRIVALS_URL ?? "").trim().replace(/\/$/, "");
  return v || "/api/baggage-arrivals";
}

function baggageArrivalsRequestUrl(searchParams: string): string {
  const base = getBaggageArrivalsBaseUrl();
  const raw = searchParams.startsWith("?") ? searchParams.slice(1) : searchParams;
  const params = new URLSearchParams(raw);
  /** Vercel CDN·엣지가 동일 URL 본문을 재사용하지 않도록 */
  params.set("_", String(Date.now()));
  return `${base}?${params.toString()}`;
}

const containsLikelyHtml = (s: string): boolean => {
  const t = s.toLowerCase();
  return (
    t.includes("<html") ||
    t.includes("<!doctype") ||
    t.includes("</body>") ||
    t.includes("<head") ||
    (t.includes("<body") && t.includes("<")) ||
    (t.includes("<h1") && t.includes("</h1>"))
  );
};

/** JSON·플레인 텍스트는 그대로(길이 제한), HTML·JSON 안 HTML은 UI용 짧은 문장으로 치환 */
export function sanitizeFetchErrorBody(text: string, httpStatus: number): string {
  const raw = text.trim();
  if (!raw) return "";
  if (/unexpected token/i.test(raw) && raw.includes("<")) {
    return htmlErrorUserMessage(httpStatus || 502, raw);
  }
  if (containsLikelyHtml(raw)) {
    return htmlErrorUserMessage(httpStatus, raw);
  }
  try {
    const parsed = JSON.parse(raw) as {
      message?: string;
      error?: string;
      response?: { header?: { resultMsg?: string } };
    };
    const msg =
      parsed.message?.trim() ||
      (typeof parsed.error === "string" ? parsed.error.trim() : "") ||
      parsed.response?.header?.resultMsg?.trim() ||
      "";
    if (msg) {
      if (containsLikelyHtml(msg)) {
        return htmlErrorUserMessage(httpStatus || 502, msg);
      }
      return msg.length > 200 ? `${msg.slice(0, 197)}...` : msg;
    }
  } catch {
    // not JSON
  }
  return raw.length > 200 ? `${raw.slice(0, 197)}...` : raw;
}

function htmlErrorUserMessage(httpStatus: number, raw: string): string {
  const h1 = raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = h1?.[1]?.replace(/<[^>]+>/g, "")?.trim();
  if (httpStatus === 502 || httpStatus === 0) {
    if (title && !/^502\s+bad\s+gateway/i.test(title)) {
      return `502 Bad Gateway — ${title}. 중계 서버가 HTML 오류를 반환했습니다.`;
    }
    return "502 Bad Gateway — 중계 서버가 HTML 오류를 반환했습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (httpStatus === 504) {
    return "504 Gateway Timeout — 서버 응답이 지연되었습니다. 잠시 후 다시 시도해 주세요.";
  }
  return title
    ? `HTTP ${httpStatus} (${title}). 서버가 HTML 오류 페이지를 반환했습니다.`
    : `HTTP ${httpStatus} — 서버가 HTML 오류 페이지를 반환했습니다.`;
}

export async function fetchBaggageSlots(): Promise<BaggageSlot[]> {
  const allSlots: BaggageSlot[] = [];
  let lastError = "";
  const parseErrorDetail = (text: string, status: number): string => sanitizeFetchErrorBody(text, status);

  const url = baggageArrivalsRequestUrl("type=json");
  /** 1분 폴링 시 CDN·브라우저 캐시로 인한 이전 응답 고착 방지 */
  const fetchInit: RequestInit = { method: "GET", cache: "no-store" };
  try {
    const res = await fetch(url, fetchInit);
    if (!res.ok) {
      let detail = "";
      try {
        const text = await res.text();
        if (text.trim()) {
          detail = parseErrorDetail(text, res.status);
        }
      } catch {
        // ignore body read failure
      }
      if (res.status === 429) {
        lastError = "API 호출 한도 초과(429)입니다. 잠시 후 다시 시도해 주세요.";
      } else if (res.status === 503) {
        lastError = detail
          ? `API 요청 실패 (503): ${detail}`
          : "API 요청 실패 (503): 서버 설정 문제일 수 있습니다. API 키·업스트림 설정(INTEGRATION.md)을 확인해 주세요.";
      } else {
        lastError = detail ? `API 요청 실패 (${res.status}): ${detail}` : `API 요청 실패 (${res.status})`;
      }
      throw new Error(lastError || "API 요청 실패");
    }
    const okBodyText = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(okBodyText);
    } catch {
      lastError = `API 응답이 JSON이 아닙니다. ${sanitizeFetchErrorBody(okBodyText, res.status)}`;
      throw new Error(lastError);
    }
    let items = extractItemsArray(json);
    const totalCount = extractTotalCount(json);

    // dev 프록시가 서버 스냅샷 대신 원본 1페이지만 줄 때(24일만 보이는 문제) 보강 수집.
    const needsFallbackFanout = totalCount > items.length && items.length <= DEV_ROWS_PER_PAGE;
    if (needsFallbackFanout) {
      const fanoutItems: unknown[] = [];
      for (const searchDay of DEV_SEARCH_DAYS) {
        for (let pageNo = 1; pageNo <= DEV_MAX_PAGE_PER_DAY; pageNo++) {
          const pageUrl = baggageArrivalsRequestUrl(
            `type=json&numOfRows=${DEV_ROWS_PER_PAGE}&pageNo=${pageNo}&searchDay=${searchDay}`
          );
          const pageRes = await fetch(pageUrl, fetchInit);
          if (!pageRes.ok) {
            const t = await pageRes.text();
            const detail = parseErrorDetail(t, pageRes.status);
            if (pageRes.status === 429) {
              throw new Error("API 호출 한도 초과(429)입니다. 잠시 후 다시 시도해 주세요.");
            }
            throw new Error(detail || `API 요청 실패 (${pageRes.status})`);
          }
          const pageBody = await pageRes.text();
          let pageJson: unknown;
          try {
            pageJson = JSON.parse(pageBody);
          } catch {
            throw new Error(sanitizeFetchErrorBody(pageBody, pageRes.status) || `API 응답 파싱 실패 (${pageRes.status})`);
          }
          const pageItems = extractItemsArray(pageJson);
          fanoutItems.push(...pageItems);
          if (pageItems.length < DEV_ROWS_PER_PAGE) break;
        }
      }
      items = fanoutItems;
    }

    allSlots.push(...items.flatMap((item) => normalizeItem(item as RawBaggageItem)));
  } catch (err) {
    if (!lastError) {
      const rawMsg = err instanceof Error ? err.message : "요청 실패";
      lastError = sanitizeFetchErrorBody(rawMsg, 0) || rawMsg;
    }
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
