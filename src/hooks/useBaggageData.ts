import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildHourRows,
  compareSlotsByEstimatedArrival,
  dedupeBaggageSlots,
  fetchBaggageSlots,
  getSlotDedupeKey,
  mergeSlotsForDate,
  RAW_ACTUAL_ARRIVAL_KEYS,
  RAW_BAG_FIRST_TIME_KEYS,
  RAW_BAG_LAST_TIME_KEYS,
  RAW_STAND_KEYS,
  sanitizeFetchErrorBody,
  sanitizeFlightDisplay,
} from "../lib/baggageApi";
import { BaggageSlot } from "../types";
import fixedScheduleJson from "../data/fixedSchedule.json";

/** `api/baggage-arrivals` UPSTREAM_CACHE_TTL_MS(60s)와 동일 — 1분 갱신 */
const REFRESH_MS = 1 * 60 * 1000;
const STORAGE_KEY = "baggage-slots-by-date-v7";
const STORAGE_META_KEY = "baggage-slots-meta-v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * 적재대 이동(`moved`) 강조 유지 시간(ms) — 다음 자동 갱신(`REFRESH_MS`)과 맞춤.
 * CSS 펄스는 `baggage-data-change-flash` 키프레임 참고.
 */
const RECENT_CHANGE_FLASH_MS = 60_000;
/** 예정 시각·시간대 등 시간 필드만 바뀐 경우 — 이동보다 짧게 유지 */
const RECENT_CHANGE_TIME_FLASH_MS = 15_000;

/** `raw` 객체에서 후보 키 중 첫 번째로 의미 있는 값을 문자열로 추출. */
const rawString = (raw: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  }
  return "";
};

/** 변경 감지에 쓰는 필드들의 스냅샷. 한 필드라도 바뀌면 그 필드 이름을 변경 사유로 보고. */
type SlotFingerprint = {
  hour: string;
  time: string;
  pieces: string;
  status: string;
  stand: string;
  first: string;
  last: string;
  arrival: string;
};

const slotFingerprint = (s: BaggageSlot): SlotFingerprint => {
  const raw = (s.raw ?? {}) as Record<string, unknown>;
  return {
    hour: s.hour,
    time: (s.estimatedTime ?? "").trim(),
    pieces: (s.pieces ?? "").trim(),
    status: (s.status ?? "").trim(),
    stand: rawString(raw, [...RAW_STAND_KEYS]),
    first: rawString(raw, [...RAW_BAG_FIRST_TIME_KEYS]),
    last: rawString(raw, [...RAW_BAG_LAST_TIME_KEYS]),
    arrival: rawString(raw, [...RAW_ACTUAL_ARRIVAL_KEYS]),
  };
};

/** 슬롯 단위로 바뀐 필드들을 추출. 비어있으면 변경 없음. */
const diffFingerprint = (a: SlotFingerprint, b: SlotFingerprint): string[] => {
  const changed: string[] = [];
  (Object.keys(a) as (keyof SlotFingerprint)[]).forEach((k) => {
    if (a[k] !== b[k]) changed.push(k);
  });
  return changed;
};

type FixedScheduleEntry = {
  hour: string;
  carousel: number;
  flight: string;
  timeStand: string;
  pieces?: string;
};

const fixedSchedule = fixedScheduleJson as Record<string, FixedScheduleEntry[]>;
/** 모든 날짜에 병합되는 고정 막바지 시간대(22·23시 등). 키 `*` 또는 `default` */
const FIXED_WILDCARD_KEYS = new Set(["*", "default"]);

const mapFixedEntries = (date: string, entries: FixedScheduleEntry[]): BaggageSlot[] =>
  entries.map((entry) => {
    const fl = sanitizeFlightDisplay(entry.flight);
    return {
      date,
      hour: entry.hour,
      carousel: entry.carousel,
      flight: fl,
      typeOfFlight: "",
      estimatedTime: entry.timeStand,
      status: "fixed",
      pieces: entry.pieces ?? "",
      note: "fixedSchedule",
      raw: {
        terminalId: "P02",
        airportCode: fl.split(/\s*\/\s*/)[1]?.trim() ?? "N/A",
        fstandPosition: entry.timeStand.split("/")[1]?.trim() ?? "-",
      },
    };
  });

const fixedWildcardSlots: BaggageSlot[] = dedupeBaggageSlots(
  mapFixedEntries("*", [...(fixedSchedule["*"] ?? []), ...(fixedSchedule["default"] ?? [])])
);

const fixedSlotsByDate: Record<string, BaggageSlot[]> = Object.fromEntries(
  Object.entries(fixedSchedule)
    .filter(([date]) => !FIXED_WILDCARD_KEYS.has(date))
    .map(([date, entries]) => [date, dedupeBaggageSlots(mapFixedEntries(date, entries))])
);

/** 슬롯이 하나도 없는 날짜 키는 선택지·저장소에서 제거 */
const pruneEmptyDates = (input: Record<string, BaggageSlot[]>): Record<string, BaggageSlot[]> => {
  const out: Record<string, BaggageSlot[]> = {};
  for (const [date, list] of Object.entries(input)) {
    if (list?.length) out[date] = list;
  }
  return out;
};

/** 이번 API 스냅샷 기준으로만 합침 — API에서 빠진 날짜의 옛 데이터는 남기지 않음. `*` 고정은 매 날짜에 합류 */
const rebuildFromFixedAndGrouped = (grouped: Record<string, BaggageSlot[]>): Record<string, BaggageSlot[]> => {
  const dates = new Set<string>([...Object.keys(fixedSlotsByDate), ...Object.keys(grouped)]);
  const merged: Record<string, BaggageSlot[]> = {};
  for (const date of dates) {
    const datedFixed = fixedSlotsByDate[date] ?? [];
    const wildcardForDate = fixedWildcardSlots.map((s) => ({ ...s, date }));
    const combinedFixed = dedupeBaggageSlots([...wildcardForDate, ...datedFixed]);
    merged[date] = mergeSlotsForDate(date, combinedFixed, grouped[date] ?? []);
  }
  return pruneEmptyDates(merged);
};

const latestDateKey = (byDate: Record<string, BaggageSlot[]>): string => {
  const keys = Object.keys(byDate).sort();
  return keys.length > 0 ? keys[keys.length - 1] : "";
};

const todaySeoulKey = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const preferredDateKey = (byDate: Record<string, BaggageSlot[]>): string => {
  const today = todaySeoulKey();
  if (byDate[today]?.length) return today;
  return latestDateKey(byDate);
};

/**
 * `typeOfFlight` 빈 API 행은 같은 편·적재대의 ‘구분 있음’ 행과 중복으로 뜨는 경우가 많아 제외.
 * 고정 스케줄(`fixedSchedule`)은 구분 필드가 비어 있으므로 항상 유지.
 */
const keepSlotWithFlightModeOrFixed = (slot: BaggageSlot): boolean => {
  if ((slot.typeOfFlight ?? "").trim().length > 0) return true;
  if (slot.note === "fixedSchedule") return true;
  if (slot.status === "fixed") return true;
  return false;
};

export function useBaggageData() {
  const [slotsByDate, setSlotsByDate] = useState<Record<string, BaggageSlot[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /** 이전 갱신 성공 이후 네트워크만 실패했을 때(표시 데이터는 유지) */
  const [refreshError, setRefreshError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const fetchSucceededRef = useRef(false);
  const [selectedDate, setSelectedDate] = useState(() => preferredDateKey(fixedSlotsByDate));
  const [userSelectedDate, setUserSelectedDate] = useState(false);
  /** 직전 fetch의 슬롯 스냅샷(key → fingerprint). 첫 fetch엔 null. */
  const prevSlotSignaturesRef = useRef<Map<string, SlotFingerprint> | null>(null);
  /** 최근 변경된 슬롯 키 → { 변경 시각(ms), 유형, 바뀐 필드 목록 } */
  const [recentChangeMap, setRecentChangeMap] = useState<
    Map<string, { ts: number; type: "modified" | "moved"; fields: string[] }>
  >(new Map());

  const handleSelectDate = useCallback((date: string) => {
    setUserSelectedDate(true);
    setSelectedDate(date);
  }, []);

  useEffect(() => {
    let mounted = true;
    let timerId: number | null = null;
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      const meta = localStorage.getItem(STORAGE_META_KEY);
      if (cached && meta) {
        const parsed = JSON.parse(cached) as Record<string, BaggageSlot[]>;
        const timestamps = JSON.parse(meta) as Record<string, number>;
        const now = Date.now();
        const livePruned: Record<string, BaggageSlot[]> = {};
        for (const [date, list] of Object.entries(parsed)) {
          const ts = timestamps[date];
          if (!ts || now - ts > CACHE_TTL_MS) continue;
          livePruned[date] = list;
        }
        const merged = pruneEmptyDates(rebuildFromFixedAndGrouped(livePruned));
        setSlotsByDate(merged);
        if (Object.keys(merged).length > 0) fetchSucceededRef.current = true;
      }
    } catch {
      // ignore cache parse errors
    }

    const load = async () => {
      try {
        const next = await fetchBaggageSlots();
        if (!mounted) return;
        const grouped: Record<string, BaggageSlot[]> = {};
        for (const slot of next) {
          const list = grouped[slot.date] ?? [];
          list.push(slot);
          grouped[slot.date] = list;
        }

        // 변경 감지
        //  - modified: 같은 슬롯 키 안에서 필드(time·first·last·stand·…) 변화 → 어떤 필드인지 기록
        //  - moved   : 사라진 키 vs 새로 나타난 키를 `날짜|편명`으로 매칭
        const newFps = new Map<string, SlotFingerprint>();
        const modifiedKeyToFields = new Map<string, string[]>();
        for (const slot of next) {
          const key = getSlotDedupeKey(slot);
          const fp = slotFingerprint(slot);
          newFps.set(key, fp);
          const prev = prevSlotSignaturesRef.current?.get(key);
          if (prev) {
            const diff = diffFingerprint(prev, fp);
            if (diff.length > 0) modifiedKeyToFields.set(key, diff);
          }
        }

        const movedKeys: string[] = [];
        const prevSigs = prevSlotSignaturesRef.current;
        const isFirstFetch = prevSigs === null;
        if (!isFirstFetch && prevSigs) {
          /** 슬롯 키(`날짜|적재대|편명`)에서 적재대를 제외한 `날짜|편명` 추출 */
          const flightIdFromKey = (key: string): string | null => {
            const parts = key.split("|");
            if (parts.length < 3) return null;
            return `${parts[0]}|${parts.slice(2).join("|")}`;
          };
          const disappearedByFlight = new Map<string, string[]>();
          for (const k of prevSigs.keys()) {
            if (newFps.has(k)) continue;
            const fid = flightIdFromKey(k);
            if (!fid) continue;
            const list = disappearedByFlight.get(fid) ?? [];
            list.push(k);
            disappearedByFlight.set(fid, list);
          }
          for (const k of newFps.keys()) {
            if (prevSigs.has(k)) continue;
            const fid = flightIdFromKey(k);
            if (!fid) continue;
            const moved = disappearedByFlight.get(fid);
            if (moved && moved.length > 0) movedKeys.push(k);
          }
        }

        prevSlotSignaturesRef.current = newFps;
        // 시각/이동만 노란색 강조 — F·L 시각, 스탠드, 상태, 수량 변경은 무시.
        const isTimeChange = (fields: string[]): boolean =>
          fields.includes("time") ||
          fields.includes("arrival") ||
          fields.includes("hour");
        const timeChangedKeys: [string, string[]][] = [];
        for (const [k, fields] of modifiedKeyToFields) {
          if (isTimeChange(fields)) timeChangedKeys.push([k, fields]);
        }
        if (!isFirstFetch && (timeChangedKeys.length > 0 || movedKeys.length > 0)) {
          setRecentChangeMap((curr) => {
            const merged = new Map(curr);
            const now = Date.now();
            for (const [k, fields] of timeChangedKeys) {
              merged.set(k, { ts: now, type: "modified", fields });
            }
            // 이동은 modified보다 우선 — 이동한 슬롯은 fields가 변경되었을 수도 있음
            for (const k of movedKeys) {
              const fields = modifiedKeyToFields.get(k) ?? [];
              merged.set(k, { ts: now, type: "moved", fields });
            }
            return merged;
          });
        }

        setSlotsByDate(() => {
          const merged = rebuildFromFixedAndGrouped(grouped);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          const now = Date.now();
          const existingMetaRaw = localStorage.getItem(STORAGE_META_KEY);
          const existingMeta = existingMetaRaw
            ? (JSON.parse(existingMetaRaw) as Record<string, number>)
            : {};
          const nextMeta: Record<string, number> = {};
          for (const [date, ts] of Object.entries(existingMeta)) {
            if (now - ts <= CACHE_TTL_MS) nextMeta[date] = ts;
          }
          for (const date of Object.keys(merged)) nextMeta[date] = now;
          for (const date of Object.keys(nextMeta)) {
            if (!merged[date]) delete nextMeta[date];
          }
          localStorage.setItem(STORAGE_META_KEY, JSON.stringify(nextMeta));
          return merged;
        });
        setError("");
        setRefreshError("");
        fetchSucceededRef.current = true;
        setLastUpdated(new Date());
      } catch (err) {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : "알 수 없는 오류";
        const safe = sanitizeFetchErrorBody(message, 0) || message;
        if (fetchSucceededRef.current) {
          setRefreshError(safe);
          setError("");
        } else {
          setError(safe);
          setRefreshError("");
        }
      } finally {
        if (mounted) setLoading(false);
      }

      if (!mounted) return;
      timerId = window.setTimeout(load, REFRESH_MS);
    };

    // 첫 호출은 즉시 실행하고 이후 1분 간격 유지
    timerId = window.setTimeout(load, 0);
    return () => {
      mounted = false;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, []);

  /** 기준 날짜: 첫 진입/새로고침은 오늘(서울) 우선으로 고정. 날짜를 직접 바꾸면 사용자 선택 유지. */
  useEffect(() => {
    const keys = Object.keys(slotsByDate).sort();
    if (keys.length === 0) {
      setSelectedDate("");
      return;
    }
    if (!userSelectedDate) {
      setSelectedDate(preferredDateKey(slotsByDate));
      return;
    }
    const latest = keys[keys.length - 1] ?? "";
    setSelectedDate((curr) => {
      if (curr && slotsByDate[curr]?.length) return curr;
      return latest;
    });
  }, [slotsByDate, userSelectedDate]);

  const slots = useMemo(() => {
    if (!selectedDate) return [];
    const list = dedupeBaggageSlots(slotsByDate[selectedDate] ?? []);
    return list.filter(keepSlotWithFlightModeOrFixed);
  }, [slotsByDate, selectedDate]);

  /** 만료된 변경 키(이동 60s·시간 15s)는 1초마다 정리. */
  useEffect(() => {
    if (recentChangeMap.size === 0) return;
    const id = window.setInterval(() => {
      setRecentChangeMap((curr) => {
        if (curr.size === 0) return curr;
        const now = Date.now();
        let mutated = false;
        const next = new Map<
          string,
          { ts: number; type: "modified" | "moved"; fields: string[] }
        >();
        for (const [k, v] of curr) {
          const ttl = v.type === "moved" ? RECENT_CHANGE_FLASH_MS : RECENT_CHANGE_TIME_FLASH_MS;
          if (now - v.ts < ttl) next.set(k, v);
          else mutated = true;
        }
        return mutated ? next : curr;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [recentChangeMap.size]);

  const recentlyChangedKeys = useMemo(
    () => new Set(recentChangeMap.keys()),
    [recentChangeMap]
  );
  const recentlyMovedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const [k, v] of recentChangeMap) if (v.type === "moved") s.add(k);
    return s;
  }, [recentChangeMap]);
  /**
   * slot key → 사람이 읽을 라벨. "이동"과 "시간"만 라벨로 노출하고,
   * 그 외(F·L, 스탠드, 상태, 수량) 변경은 노란색 강조만 띄우고 배지는 생략한다.
   */
  const recentChangeLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const [k, v] of recentChangeMap) {
      if (v.type === "moved") {
        map.set(k, "이동");
        continue;
      }
      const isTimeLike =
        v.fields.includes("time") ||
        v.fields.includes("arrival") ||
        v.fields.includes("hour");
      if (isTimeLike) map.set(k, "시간");
    }
    return map;
  }, [recentChangeMap]);

  const byHourCarousel = useMemo(() => {
    const map = new Map<string, BaggageSlot[]>();
    for (const slot of slots) {
      const key = `${slot.hour}-${slot.carousel}`;
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort(compareSlotsByEstimatedArrival);
    }
    return map;
  }, [slots]);

  return {
    slots,
    slotsByDate,
    selectedDate,
    setSelectedDate: handleSelectDate,
    loading,
    error,
    refreshError,
    lastUpdated,
    hours: buildHourRows(),
    byHourCarousel,
    recentlyChangedKeys,
    recentlyMovedKeys,
    recentChangeLabels,
  };
}

