import { useEffect, useMemo, useState } from "react";
import { buildHourRows, fetchBaggageSlots } from "../lib/baggageApi";
import { BaggageSlot } from "../types";

const REFRESH_MS = 5 * 60 * 1000;

export function useBaggageData() {
  const [slots, setSlots] = useState<BaggageSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const next = await fetchBaggageSlots();
        if (!mounted) return;
        setSlots(next);
        setError("");
        setLastUpdated(new Date());
      } catch (err) {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : "알 수 없는 오류";
        setError(message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, []);

  const byHourCarousel = useMemo(() => {
    const map = new Map<string, BaggageSlot[]>();
    for (const slot of slots) {
      const key = `${slot.hour}-${slot.carousel}`;
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    return map;
  }, [slots]);

  return {
    slots,
    loading,
    error,
    lastUpdated,
    hours: buildHourRows(),
    byHourCarousel,
  };
}
