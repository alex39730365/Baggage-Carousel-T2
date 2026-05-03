import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildHourRows,
  compareSlotsByEstimatedArrival,
  dedupeBaggageSlots,
  fetchBaggageSlots,
  mergeSlotsForDate,
  sanitizeFlightDisplay,
} from "../lib/baggageApi";
import { BaggageSlot } from "../types";
import fixedScheduleJson from "../data/fixedSchedule.json";

/** `api/baggage-arrivals` UPSTREAM_CACHE_TTL_MS(60s)와 동일 — 1분 갱신 */
const REFRESH_MS = 1 * 60 * 1000;
const STORAGE_KEY = "baggage-slots-by-date-v7";
const STORAGE_META_KEY = "baggage-slots-meta-v1";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => preferredDateKey(fixedSlotsByDate));
  const [userSelectedDate, setUserSelectedDate] = useState(false);

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
        setLastUpdated(new Date());
      } catch (err) {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : "알 수 없는 오류";
        setError(message);
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
    lastUpdated,
    hours: buildHourRows(),
    byHourCarousel,
  };
}

