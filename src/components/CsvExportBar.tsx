import { track } from "@vercel/analytics";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TabKey } from "../dashboard/controlTypes";
import { DASH_LABEL } from "../dashboard/dashboardUi";
import type { BaggageSlot } from "../types";
import { appendClientAudit } from "../lib/clientAuditLog";
import { buildBaggageSlotsCsv, downloadCsvFile } from "../lib/csvExport";

const TAB_SLUG: Record<TabKey, string> = {
  all: "전체",
  terminal1: "T1",
  terminal2: "T2",
  unknown: "기타",
};

const seoulHmsStamp = (): string => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(new Date());
  const two = (t: Intl.DateTimeFormatPartTypes) =>
    (parts.find((x) => x.type === t)?.value ?? "00").replace(/\D/g, "").padStart(2, "0");
  return `${two("hour")}${two("minute")}${two("second")}`;
};

export type CsvExportBarProps = {
  visibleSlots: BaggageSlot[];
  selectedDate: string;
  activeTab: TabKey;
};

const TOAST_MS = 3500;

export function CsvExportBar({ visibleSlots, selectedDate, activeTab }: CsvExportBarProps) {
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, TOAST_MS);
  }, []);

  const handleExportCsv = useCallback(() => {
    if (visibleSlots.length === 0) return;
    const slug = TAB_SLUG[activeTab];
    const csv = buildBaggageSlotsCsv(visibleSlots);
    const name = `수하물현황_${selectedDate}_${slug}_${seoulHmsStamp()}.csv`;
    downloadCsvFile(name, csv);
    const n = visibleSlots.length;
    showToast(`저장했습니다. ${n}행 · ${name}`);
    track("csv_export", { rows: n, date: selectedDate, tab: activeTab });
    appendClientAudit({
      action: "csv_export",
      detail: { rows: n, date: selectedDate, tab: activeTab, filename: name },
    });
  }, [visibleSlots, selectedDate, activeTab, showToast]);

  const disabled = visibleSlots.length === 0;

  return (
    <>
      <div
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm sm:px-4"
        role="group"
        aria-label="CSV보내기"
      >
        <div className="flex items-center justify-between gap-4">
          <span className={DASH_LABEL}>CSV</span>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={disabled}
            title={
              disabled
                ? "보낼 행이 없습니다."
                : "선택한 날짜·터미널·코드셰어 필터와 동일한 목록을 파일로 저장합니다."
            }
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e40af] sm:text-[13px] ${
              disabled
                ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                : "border-[#1e40af] bg-[#1e40af] text-white shadow-sm hover:bg-[#1e3a8a]"
            }`}
          >
            <svg
              className="h-3.5 w-3.5 shrink-0 opacity-95"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            저장
          </button>
        </div>
      </div>
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="fixed bottom-4 left-1/2 z-[200] max-w-[min(90vw,24rem)] -translate-x-1/2 rounded-lg border border-slate-200 bg-slate-900 px-4 py-2.5 text-center text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      ) : null}
    </>
  );
}
