import type { BaggageSlot } from "../types";
import { CsvExportBar } from "../components/CsvExportBar";
import type { DisplayMode, FlightSearchRow, TabKey } from "../dashboard/controlTypes";
import { TAB_ITEMS } from "../dashboard/controlTypes";
import { DASH_CARD, DASH_INPUT, DASH_LABEL, DASH_ROW, DASH_SELECT, dashBtn } from "../dashboard/dashboardUi";

export type DashboardControlStackProps = {
  displayMode: DisplayMode;
  onDisplayModeChange: (mode: DisplayMode) => void;
  activeTab: TabKey;
  onActiveTabChange: (tab: TabKey) => void;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  availableDates: string[];
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  searchRows: FlightSearchRow[];
  navigateFlashKey: string | null;
  kePinkHighlight: boolean;
  dataChangeHighlight: boolean;
  onToggleDataChangeHighlight: () => void;
  onSearchRowNavigate: (dedupeKey: string) => void;
  isMainlineKeFlight: (flight: string) => boolean;
  visibleSlots: BaggageSlot[];
};

export function DashboardControlStack({
  displayMode,
  onDisplayModeChange,
  activeTab,
  onActiveTabChange,
  selectedDate,
  onSelectedDateChange,
  availableDates,
  keyword,
  onKeywordChange,
  searchRows,
  navigateFlashKey,
  kePinkHighlight,
  dataChangeHighlight,
  onToggleDataChangeHighlight,
  onSearchRowNavigate,
  isMainlineKeFlight,
  visibleSlots,
}: DashboardControlStackProps) {
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className={DASH_CARD} role="group" aria-label="화면 형식">
        <div className={DASH_ROW}>
          <span className={DASH_LABEL}>화면</span>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-start">
            <button type="button" onClick={() => onDisplayModeChange("table")} className={dashBtn(displayMode === "table")}>
              케로셀 현황
            </button>
            <button
              type="button"
              onClick={() => onDisplayModeChange("processing")}
              title="첫·마지막 수하물 벨트 도착 시각을 격자와 같은 표 형태로 봅니다."
              className={dashBtn(displayMode === "processing")}
            >
              수하물 처리 시간
            </button>
            <button type="button" onClick={() => onDisplayModeChange("cards")} className={dashBtn(displayMode === "cards")}>
              모바일
            </button>
          </div>
        </div>
      </div>

      <div className={DASH_CARD} role="group" aria-label="터미널">
        <div className={DASH_ROW}>
          <span className={DASH_LABEL}>터미널</span>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-start">
            {TAB_ITEMS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => onActiveTabChange(tab.key)}
                className={dashBtn(activeTab === tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={DASH_CARD}>
        <div className={DASH_ROW}>
          <label htmlFor="date-select" className={DASH_LABEL}>
            날짜
          </label>
          <select
            id="date-select"
            value={selectedDate}
            onChange={(e) => onSelectedDateChange(e.target.value)}
            className={DASH_SELECT}
          >
            {availableDates.map((date) => (
              <option key={date} value={date}>
                {date}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={DASH_CARD}>
        <div className={DASH_ROW}>
          <label htmlFor="flight-search" className={DASH_LABEL}>
            편명
          </label>
          <input
            id="flight-search"
            value={keyword}
            onChange={(e) => onKeywordChange(e.target.value)}
            placeholder="편명 검색 (예 : KE714)"
            className={DASH_INPUT}
            autoComplete="off"
            enterKeyHint="search"
          />
        </div>
        {!!keyword.trim() && (
          <div className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-700">
            {searchRows.length === 0 ? (
              <p className="text-slate-500">검색 결과가 없습니다.</p>
            ) : (
              <div className="space-y-1">
                {searchRows.map((row) => (
                  <button
                    key={row.dedupeKey}
                    type="button"
                    onClick={() => onSearchRowNavigate(row.dedupeKey)}
                    className={`min-h-[44px] w-full rounded-md px-2 py-2.5 text-left text-xs leading-snug transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-400 sm:min-h-0 sm:px-1 sm:py-1 ${
                      navigateFlashKey === row.dedupeKey
                        ? "border-2 border-pink-500 bg-pink-200 text-slate-900 shadow-[inset_0_0_0_1px_rgba(236,72,153,0.35),0_0_12px_rgba(236,72,153,0.4)]"
                        : kePinkHighlight && isMainlineKeFlight(row.flight)
                          ? "border-2 border-transparent bg-blue-100 text-slate-900 hover:bg-blue-200/90"
                          : "border-2 border-transparent bg-transparent text-slate-700 hover:bg-slate-100/80"
                    }`}
                    aria-label={`${row.flight} 목록·격자·수하물 처리 시간에서 해당 위치로 이동`}
                  >
                    {row.flight} — 시간{" "}
                    <span className="font-bold tabular-nums text-slate-950">{row.time}</span> — 적재대 {row.carousel}번
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <CsvExportBar visibleSlots={visibleSlots} selectedDate={selectedDate} activeTab={activeTab} />

      <div className="flex justify-end pr-0.5">
        <button
          type="button"
          aria-pressed={dataChangeHighlight}
          aria-label={
            dataChangeHighlight
              ? "적재대·시간 변경 노란 강조 끄기"
              : "적재대·시간 변경 노란 강조 켜기"
          }
          title={
            dataChangeHighlight
              ? "적재대·시간 이동 시 노란색 강조를 끕니다."
              : "API 갱신으로 바뀐 칸을 노란색으로 다시 강조합니다."
          }
          onClick={onToggleDataChangeHighlight}
          className={`max-w-[9rem] truncate text-[10px] leading-tight text-slate-400/90 underline-offset-2 transition-colors hover:text-slate-500 focus-visible:rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-slate-300 ${
            dataChangeHighlight ? "hover:underline" : "font-medium text-slate-500 hover:underline"
          }`}
        >
          {dataChangeHighlight ? "변경 강조 끄기" : "변경 강조 켜기"}
        </button>
      </div>
    </div>
  );
}
