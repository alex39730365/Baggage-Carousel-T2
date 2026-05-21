/** 관리자 대시보드: 흰 카드·행(좌 라벨 / 우 컨트롤) — `BaggageCarouselBoard`와 공유 */
export const DASH_CARD =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm sm:px-5 sm:py-4";
export const DASH_ROW =
  "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-start sm:gap-4 md:gap-6";
export const DASH_LABEL =
  "shrink-0 text-sm font-semibold leading-tight tracking-tight text-slate-600 sm:min-w-[5.5rem] md:min-w-[6rem]";

export const dashBtn = (on: boolean) =>
  [
    "rounded-lg border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e40af]/70 sm:text-[13px]",
    on
      ? "border-[#1e40af] bg-[#1e40af] text-white shadow-sm"
      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
  ].join(" ");

export const DASH_SELECT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] outline-none transition-shadow focus:border-[#1e40af]/55 focus:ring-2 focus:ring-[#1e40af]/18 sm:w-auto sm:min-w-[12rem] sm:max-w-[16rem]";
export const DASH_INPUT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] outline-none transition-shadow placeholder:text-slate-400 focus:border-[#1e40af]/55 focus:ring-2 focus:ring-[#1e40af]/18 sm:max-w-md sm:min-w-[18rem]";
