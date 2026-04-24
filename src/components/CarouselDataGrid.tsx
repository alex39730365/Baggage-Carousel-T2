import type { ReactNode } from "react";
import { BaggageSlot } from "../types";
import { getSlotDedupeKey } from "../lib/baggageApi";

/** 격자 열 수·캐로셀 번호 (1–20) */
export const FIXED_CAROUSELS = Array.from({ length: 20 }, (_, i) => i + 1);

const CAROUSEL_GUIDE_AFTER_NO = 10;
const CAROUSEL_GUIDE_TOGGLE_NOS = new Set([10, 11]);
export const carouselGuideLineClass = "border-r-[3px] border-r-red-600";

function CornerHeaderCell() {
  return (
    <div className="flex w-full min-w-0 flex-col items-center justify-center gap-0.5 py-0.5 text-[7px] font-semibold leading-tight sm:text-[8px]">
      <span className="shrink-0 font-bold text-slate-950">시간</span>
      <span className="shrink-0 font-medium text-slate-600">캐로셀</span>
    </div>
  );
}

export function GridHeaderRow({
  guideVisible,
  onToggleGuide,
}: {
  guideVisible: boolean;
  onToggleGuide: () => void;
}) {
  return (
    <tr>
      <th className="w-9 min-w-0 border border-slate-200 bg-slate-50 px-0.5 py-1 font-semibold text-slate-700 sm:w-10 sm:py-1.5">
        <CornerHeaderCell />
      </th>
      {FIXED_CAROUSELS.map((no) => {
        const guideLine = guideVisible && no === CAROUSEL_GUIDE_AFTER_NO;
        const togglesGuide = CAROUSEL_GUIDE_TOGGLE_NOS.has(no);
        return (
          <th
            key={no}
            scope="col"
            className={`min-w-0 border border-slate-200 bg-yellow-100 px-0.5 py-1 text-center text-[9px] font-semibold text-slate-800 sm:text-[10px] ${
              guideLine ? carouselGuideLineClass : ""
            }`}
          >
            {togglesGuide ? (
              <button
                type="button"
                className="w-full rounded-sm py-0.5 font-inherit text-inherit hover:bg-yellow-200/80 active:bg-yellow-300/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-600"
                onClick={onToggleGuide}
                aria-pressed={guideVisible}
                title={
                  guideVisible
                    ? "10번·11번 사이 빨간 가이드선 끄기"
                    : "10번·11번 사이 빨간 가이드선 켜기"
                }
              >
                {no}
              </button>
            ) : (
              no
            )}
          </th>
        );
      })}
    </tr>
  );
}

export type CarouselGridVariant = "schedule" | "processing";

export type CarouselDataGridProps = {
  hours: string[];
  byHourCarousel: Map<string, BaggageSlot[]>;
  carouselGuideVisible: boolean;
  onToggleGuide: () => void;
  highlightKeys: Set<string>;
  navigateFlashKey: string | null;
  kePinkHighlight: boolean;
  toggleHighlightKey: (slotKey: string) => void;
  variant: CarouselGridVariant;
  renderCellContent: (item: BaggageSlot) => ReactNode;
  slotShellClassFn: (starHighlighted: boolean, flight: string, kePinkOn: boolean) => string;
  navigateFlashShellClass: string;
};

export function CarouselDataGrid({
  hours,
  byHourCarousel,
  carouselGuideVisible,
  onToggleGuide,
  highlightKeys,
  navigateFlashKey,
  kePinkHighlight,
  toggleHighlightKey,
  variant,
  renderCellContent,
  slotShellClassFn,
  navigateFlashShellClass,
}: CarouselDataGridProps) {
  const ariaCtx = variant === "processing" ? "수화물 처리 시간 격자" : "격자 칸 클릭";
  const keyPrefix = variant === "processing" ? "proc-" : "";

  return (
    <table className="w-full min-w-0 table-fixed border-collapse text-[8px] text-slate-800 sm:text-[9px] lg:text-[10px]">
      <thead className="sticky top-0 z-20 bg-slate-50 ring-1 ring-slate-200/60">
        <GridHeaderRow guideVisible={carouselGuideVisible} onToggleGuide={onToggleGuide} />
      </thead>
      <tbody>
        {hours.map((hour) => (
          <tr key={`${keyPrefix}${hour}`}>
            <td className="w-9 min-w-0 border border-slate-200 bg-slate-50 px-0.5 py-1 text-center text-[9px] font-bold tabular-nums tracking-tight text-slate-950 sm:w-10 sm:text-[10px]">
              {hour}
            </td>
            {FIXED_CAROUSELS.map((carousel) => {
              const key = `${hour}-${carousel}`;
              const items = byHourCarousel.get(key) ?? [];
              return (
                <td
                  key={`${keyPrefix}${key}`}
                  className={`min-h-[52px] min-w-0 border border-slate-200 align-top p-0.5 sm:min-h-[56px] ${
                    carouselGuideVisible && carousel === CAROUSEL_GUIDE_AFTER_NO
                      ? carouselGuideLineClass
                      : ""
                  }`}
                >
                  <div className="min-w-0 max-w-full space-y-0.5">
                    {items.length === 0 ? (
                      <span className="text-[11px] text-slate-300" />
                    ) : (
                      items.map((item, idx) => {
                        const slotKey = getSlotDedupeKey(item);
                        const highlighted = highlightKeys.has(slotKey);
                        return (
                          <article
                            key={`${keyPrefix}${slotKey}#${idx}`}
                            data-baggage-slot={slotKey}
                            role="button"
                            tabIndex={0}
                            aria-pressed={highlighted}
                            aria-label={
                              highlighted
                                ? `${item.flight || "항공편"} 강조 해제 (${ariaCtx})`
                                : `${item.flight || "항공편"} 강조 표시 (${ariaCtx})`
                            }
                            onClick={() => toggleHighlightKey(slotKey)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggleHighlightKey(slotKey);
                              }
                            }}
                            className={`relative min-w-0 max-w-full cursor-pointer touch-manipulation rounded border p-0.5 leading-tight text-slate-800 outline-none transition-[box-shadow,background-color] duration-200 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 ${slotShellClassFn(
                              highlighted,
                              item.flight,
                              kePinkHighlight
                            )} ${navigateFlashKey === slotKey ? navigateFlashShellClass : ""}`}
                          >
                            {renderCellContent(item)}
                          </article>
                        );
                      })
                    )}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
