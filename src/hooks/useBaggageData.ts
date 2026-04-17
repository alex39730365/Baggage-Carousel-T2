import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildHourRows,
  compareSlotsByEstimatedArrival,
  dedupeBaggageSlots,
  fetchBaggageSlots,
  mergeSlotsForDate,
} from "../lib/baggageApi";
import { BaggageSlot } from "../types";
import fixedScheduleJson from "../data/fixedSchedule.json";

const REFRESH_MS = 1 * 60 * 1000;
const JITTER_MS = 20 * 1000;
const STORAGE_KEY = "baggage-slots-by-date-v6";
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

const fixedSlotsByDate: Record<string, BaggageSlot[]> = Object.fromEntries(
  Object.entries(fixedSchedule).map(([date, entries]) => [
    date,
    dedupeBaggageSlots(
      entries.map((entry) => ({
        date,
        hour: entry.hour,
        carousel: entry.carousel,
        flight: entry.flight,
        typeOfFlight: "",
        estimatedTime: entry.timeStand,
        status: "fixed",
        pieces: entry.pieces ?? "",
        note: "fixedSchedule",
        raw: {
          terminalId: "P02",
          airportCode: entry.flight.split("/")[1]?.trim() ?? "N/A",
          fstandPosition: entry.timeStand.split("/")[1]?.trim() ?? "-",
        },
      }))
    ),
  ])
);

/** 슬롯이 하나도 없는 날짜 키는 선택지·저장소에서 제거 */
const pruneEmptyDates = (input: Record<string, BaggageSlot[]>): Record<string, BaggageSlot[]> => {
  const out: Record<string, BaggageSlot[]> = {};
  for (const [date, list] of Object.entries(input)) {
    if (list?.length) out[date] = list;
  }
  return out;
};

/** 이번 API 스냅샷 기준으로만 합침 — API에서 빠진 날짜의 옛 데이터는 남기지 않음 */
const rebuildFromFixedAndGrouped = (grouped: Record<string, BaggageSlot[]>): Record<string, BaggageSlot[]> => {
  const dates = new Set([...Object.keys(fixedSlotsByDate), ...Object.keys(grouped)]);
  const merged: Record<string, BaggageSlot[]> = {};
  for (const date of dates) {
    merged[date] = mergeSlotsForDate(date, fixedSlotsByDate[date] ?? [], grouped[date] ?? []);
  }
  return pruneEmptyDates(merged);
};

const latestDateKey = (byDate: Record<string, BaggageSlot[]>): string => {
  const keys = Object.keys(byDate).sort();
  return keys.length > 0 ? keys[keys.length - 1] : "";
};

export function useBaggageData() {
  const [slotsByDate, setSlotsByDate] = useState<Record<string, BaggageSlot[]>>(fixedSlotsByDate);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => latestDateKey(fixedSlotsByDate));
  /** 새로고침·첫 진입: 첫 로딩이 끝날 때까지 기준 날짜를 항상 데이터상 최신 날짜로 맞춤. 이후에는 사용자 선택 유지. */
  const pinSelectedToLatestUntilReadyRef = useRef(true);

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
      const jitter = Math.floor(Math.random() * JITTER_MS);
      timerId = window.setTimeout(load, REFRESH_MS + jitter);
    };

    // 첫 호출도 랜덤 지연을 넣어 동시 시작을 분산
    const initialJitter = Math.floor(Math.random() * JITTER_MS);
    timerId = window.setTimeout(load, initialJitter);
    return () => {
      mounted = false;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, []);

  /** 기준 날짜: 로딩 중·첫 로딩 직후에는 항상 최신 날짜 키로 고정. 이후에는 유효하면 유지, 없으면 최신으로. */
  useEffect(() => {
    const keys = Object.keys(slotsByDate).sort();
    if (keys.length === 0) {
      setSelectedDate("");
      return;
    }
    const latest = keys[keys.length - 1] ?? "";
    if (pinSelectedToLatestUntilReadyRef.current) {
      setSelectedDate(latest);
      if (!loading) pinSelectedToLatestUntilReadyRef.current = false;
      return;
    }
    setSelectedDate((curr) => {
      if (curr && slotsByDate[curr]?.length) return curr;
      return latest;
    });
  }, [slotsByDate, loading]);

  const slots = useMemo(() => {
    if (!selectedDate) return [];
    return dedupeBaggageSlots(slotsByDate[selectedDate] ?? []);
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
    setSelectedDate,
    loading,
    error,
    lastUpdated,
    hours: buildHourRows(),
    byHourCarousel,
  };
}

