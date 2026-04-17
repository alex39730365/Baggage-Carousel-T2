import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBaggageData } from "../hooks/useBaggageData";
import { getSlotDedupeKey } from "../lib/baggageApi";
import { BaggageSlot } from "../types";

const HIGHLIGHT_STORAGE_KEY = "baggage-highlight-keys-v1";

const loadHighlightSet = (): Set<string> => {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(HIGHLIGHT_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
};

const persistHighlights = (keys: Set<string>) => {
  try {
    localStorage.setItem(HIGHLIGHT_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // ignore
  }
};

/** 목록·격자 카드 공통: 테두리+배경 (비강조는 기존과 비슷한 톤). */
const highlightShellClass = (on: boolean) =>
  on
    ? "border-amber-400/90 bg-amber-50 ring-1 ring-amber-300/60"
    : "border-slate-200/90 bg-slate-50";

/** 모바일 최소 터치 영역(~44px), sm 이상은 조금 줄여 격자 밀도 유지 */
const highlightMarkHitClass = "min-h-[44px] min-w-[44px] sm:min-h-9 sm:min-w-9";
const highlightMarkButtonBaseClass = [
  "inline-flex shrink-0 items-center justify-center rounded-md leading-none",
  "text-slate-400 active:bg-slate-300/80 active:text-slate-700",
  "hover:bg-slate-200/60 hover:text-slate-600",
  highlightMarkHitClass,
].join(" ");
/** 목록 카드 별 */
const highlightMarkButtonClassList = `${highlightMarkButtonBaseClass} text-[15px]`;

/** 편명 검색에서 줄·해당 슬롯을 잠깐 강조할 때 (약 2.2초). */
const NAVIGATE_FLASH_MS = 2200;
const navigateFlashShellClass = "z-[1] bg-sky-100/95 ring-2 ring-sky-400/90";

const FIXED_CAROUSELS = Array.from({ length: 20 }, (_, i) => i + 1);
type TabKey = "all" | "terminal1" | "terminal2" | "unknown";
type DisplayMode = "cards" | "table";
type TableWidthMode = "scroll" | "fit";

const TAB_ITEMS: { key: TabKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "terminal1", label: "터미널1" },
  { key: "terminal2", label: "터미널2" },
  { key: "unknown", label: "미지정/기타" },
];
const formatTime = (value: string) => {
  const compact = value.replace(/\D/g, "");
  if (compact.length >= 12) return `${compact.slice(8, 10)}:${compact.slice(10, 12)}`;
  const match = value.match(/(\d{2}:\d{2})/);
  return match ? match[1] : value;
};

const getAirportCode = (raw: Record<string, unknown>): string => {
  const code = raw.airportCode;
  if (typeof code === "string" && code.trim()) return code.trim();
  const airport = raw.airport;
  if (typeof airport === "string" && airport.trim()) return airport.trim();
  return "UNK";
};

const getStand = (raw: Record<string, unknown>): string => {
  const stand = raw.fstandPosition ?? raw.gateNumber;
  if (typeof stand === "string" && stand.trim()) return stand.trim();
  if (typeof stand === "number") return String(stand);
  return "-";
};

/** IIAC 공공데이터에서 쓰는 터미널 코드만 인정 (게이트·스탠드 숫자 '106' 등은 제외). */
const normalizeTerminalToken = (value: unknown): string => {
  if (typeof value === "string") return value.trim().toUpperCase().replace(/\uFEFF/g, "");
  if (typeof value === "number" && Number.isFinite(value)) return String(value).trim().toUpperCase();
  return "";
};

const getTerminal = (raw: Record<string, unknown>): string => {
  for (const key of ["terminalId", "terminal"] as const) {
    const t = normalizeTerminalToken(raw[key]);
    if (!t) continue;
    if (/^P0[123]$/.test(t)) return t;
    if (/^T[12]$/.test(t)) return t;
    if (/^TERMINAL[12]$/.test(t)) return t;
  }
  return "";
};

const getTerminalGroup = (raw: Record<string, unknown>): "terminal1" | "terminal2" | "unknown" => {
  const terminal = getTerminal(raw);
  if (!terminal) return "unknown";

  // P03은 API에서 관측되며 터미널2 계열로 묶는다. (includes('1') 같은 휴리스틱은 게이트 번호 106→T1 오분류를 일으켜 쓰지 않음)
  if (terminal === "P01" || terminal === "T1" || terminal === "TERMINAL1") return "terminal1";
  if (terminal === "P02" || terminal === "P03" || terminal === "T2" || terminal === "TERMINAL2")
    return "terminal2";

  return "unknown";
};

const filterByTab = (slots: BaggageSlot[], tab: TabKey): BaggageSlot[] => {
  if (tab === "all") return slots;
  if (tab === "terminal1") return slots.filter((slot) => getTerminalGroup(slot.raw) === "terminal1");
  if (tab === "terminal2") return slots.filter((slot) => getTerminalGroup(slot.raw) === "terminal2");
  return slots.filter((slot) => getTerminalGroup(slot.raw) === "unknown");
};

/** 공공데이터 `typeOfFlight`: O 출발, I·D 도착 등 (표시용). */
const getFlightModeLabel = (typeOfFlight: string | undefined): string => {
  const t = (typeOfFlight ?? "").trim().toUpperCase();
  if (t === "O") return "출발";
  if (t === "I" || t === "D") return "도착";
  if (!t) return "구분 미표시";
  return `구분 ${t}`;
};

/** 출발(O)만 제외 — I·D·구분 없음(고정 스케줄)은 표시. */
const excludeOutboundFlights = (slots: BaggageSlot[]): BaggageSlot[] =>
  slots.filter((slot) => (slot.typeOfFlight ?? "").trim().toUpperCase() !== "O");

const SlotDetail = ({ item, compact }: { item: BaggageSlot; compact?: boolean }) =>
  compact ? (
    <>
      <p className="break-words font-semibold leading-tight text-slate-900">
        {`${item.flight || "미지정"} / ${getAirportCode(item.raw)}`}
      </p>
      <p className="leading-tight text-[9px] text-blue-700 sm:text-[10px]">{getFlightModeLabel(item.typeOfFlight)}</p>
      <p className="break-words leading-tight text-slate-700">{`${formatTime(item.estimatedTime)} / ${getStand(item.raw)}`}</p>
      {!!item.pieces && (
        <p className="break-words leading-tight text-slate-600">
          {item.pieces.toLowerCase().includes("pc") ? item.pieces : `${item.pieces} pc`}
        </p>
      )}
    </>
  ) : (
    <>
      <p className="font-semibold text-slate-900">
        {`${item.flight || "미지정"} / ${getAirportCode(item.raw)}`}
      </p>
      <p className="text-[10px] text-blue-700 sm:text-[11px]">{getFlightModeLabel(item.typeOfFlight)}</p>
      <p className="text-slate-700">{`${formatTime(item.estimatedTime)} / ${getStand(item.raw)}`}</p>
      {!!item.pieces && (
        <p className="text-slate-600">
          {item.pieces.toLowerCase().includes("pc") ? item.pieces : `${item.pieces} pc`}
        </p>
      )}
    </>
  );

export default function BaggageCarouselBoard() {
  const { hours, loading, error, lastUpdated, slots, slotsByDate, selectedDate, setSelectedDate } =
    useBaggageData();
  const [keyword, setKeyword] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("terminal2");
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches
      ? "cards"
      : "table"
  );
  const [tableWidthMode, setTableWidthMode] = useState<TableWidthMode>("scroll");
  const [highlightKeys, setHighlightKeys] = useState<Set<string>>(loadHighlightSet);
  const [navigateFlashKey, setNavigateFlashKey] = useState<string | null>(null);
  const navigateFlashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (navigateFlashTimerRef.current !== null) window.clearTimeout(navigateFlashTimerRef.current);
    };
  }, []);

  const toggleHighlightKey = useCallback((slotKey: string) => {
    setHighlightKeys((prev) => {
      const next = new Set(prev);
      if (next.has(slotKey)) next.delete(slotKey);
      else next.add(slotKey);
      persistHighlights(next);
      return next;
    });
  }, []);

  const clearAllHighlights = useCallback(() => {
    setHighlightKeys(new Set());
    persistHighlights(new Set());
  }, []);

  const scrollToSlotKey = useCallback((slotKey: string) => {
    const run = () => {
      const safe =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(slotKey)
          : slotKey.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const el = document.querySelector(`[data-baggage-slot="${safe}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      }
    };
    requestAnimationFrame(run);
  }, []);

  const handleSearchRowClick = useCallback(
    (dedupeKey: string) => {
      if (navigateFlashTimerRef.current !== null) {
        window.clearTimeout(navigateFlashTimerRef.current);
        navigateFlashTimerRef.current = null;
      }
      setNavigateFlashKey(dedupeKey);
      scrollToSlotKey(dedupeKey);
      navigateFlashTimerRef.current = window.setTimeout(() => {
        setNavigateFlashKey(null);
        navigateFlashTimerRef.current = null;
      }, NAVIGATE_FLASH_MS);
    },
    [scrollToSlotKey]
  );

  const visibleSlots = useMemo(
    () => excludeOutboundFlights(filterByTab(slots, activeTab)),
    [slots, activeTab]
  );

  const byHourCarousel = useMemo(() => {
    const map = new Map<string, BaggageSlot[]>();
    for (const slot of visibleSlots) {
      const key = `${slot.hour}-${slot.carousel}`;
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    return map;
  }, [visibleSlots]);

  const searchRows = useMemo(() => {
    const q = keyword.trim().toUpperCase();
    if (!q) return [];
    const matches = visibleSlots
      .filter((slot) => slot.flight.toUpperCase().includes(q))
      .map((slot) => ({
        dedupeKey: getSlotDedupeKey(slot),
        flight: slot.flight,
        typeOfFlight: slot.typeOfFlight,
        hour: slot.hour,
        time: formatTime(slot.estimatedTime),
        carousel: slot.carousel,
      }));

    const unique = new Map<string, (typeof matches)[number]>();
    for (const row of matches) {
      if (!unique.has(row.dedupeKey)) unique.set(row.dedupeKey, row);
    }
    return [...unique.values()]
      .sort((a, b) => `${a.hour}-${a.carousel}`.localeCompare(`${b.hour}-${b.carousel}`))
      .slice(0, 20);
  }, [keyword, visibleSlots]);

  const availableDates = useMemo(() => Object.keys(slotsByDate).sort(), [slotsByDate]);

  const cardSlotsByHour = useMemo(() => {
    const map = new Map<string, Map<string, BaggageSlot>>();
    for (const slot of visibleSlots) {
      const hour = slot.hour;
      let inner = map.get(hour);
      if (!inner) {
        inner = new Map();
        map.set(hour, inner);
      }
      inner.set(getSlotDedupeKey(slot), slot);
    }
    const out = new Map<string, BaggageSlot[]>();
    for (const [hour, inner] of map) {
      const list = [...inner.values()].sort(
        (a, b) => a.carousel - b.carousel || a.flight.localeCompare(b.flight)
      );
      out.set(hour, list);
    }
    return out;
  }, [visibleSlots]);

  return (
    <section className="space-y-3 sm:space-y-4">
      <header className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <h1 className="text-lg font-bold text-slate-900 sm:text-xl">Baggage Carousel 현황</h1>
        <p className="mt-1 text-xs text-slate-600 sm:text-sm">API 자동 갱신: 1분 간격</p>
        <p className="mt-1 text-[11px] text-slate-500 sm:text-xs">
          마지막 갱신: {lastUpdated ? lastUpdated.toLocaleString("ko-KR", { hour12: false }) : "-"}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="화면 형식">
          <span className="text-[11px] font-medium text-slate-600 sm:text-xs">화면</span>
          <button
            type="button"
            onClick={() => setDisplayMode("cards")}
            className={`rounded-md border px-3 py-2.5 text-[11px] font-medium sm:px-2.5 sm:py-1.5 sm:text-xs ${
              displayMode === "cards"
                ? "border-indigo-700 bg-indigo-700 text-white"
                : "border-indigo-200 bg-white text-indigo-800 hover:bg-indigo-50"
            }`}
          >
            목록
          </button>
          <button
            type="button"
            onClick={() => setDisplayMode("table")}
            className={`rounded-md border px-3 py-2.5 text-[11px] font-medium sm:px-2.5 sm:py-1.5 sm:text-xs ${
              displayMode === "table"
                ? "border-indigo-700 bg-indigo-700 text-white"
                : "border-indigo-200 bg-white text-indigo-800 hover:bg-indigo-50"
            }`}
          >
            격자
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="강조 표시">
          <button
            type="button"
            onClick={clearAllHighlights}
            disabled={highlightKeys.size === 0}
            aria-label="목록·격자에서 지정한 강조 표시를 전부 해제하고 저장도 비웁니다"
            className="rounded-md border border-amber-300 bg-white px-3 py-2.5 text-[11px] font-medium text-amber-900 hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 sm:px-2.5 sm:py-1.5 sm:text-xs"
          >
            강조 모두 해제
          </button>
          {highlightKeys.size > 0 ? (
            <span className="text-[10px] text-slate-500 sm:text-[11px]">{highlightKeys.size}건 지정됨</span>
          ) : (
            <span className="text-[10px] text-slate-400 sm:text-[11px]">지정 없음</span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="date-select" className="text-[11px] font-medium text-slate-600 sm:text-xs">
            기준 날짜
          </label>
          <select
            id="date-select"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full max-w-[220px] rounded-md border border-emerald-300 bg-white px-2.5 py-2.5 text-base font-medium text-emerald-800 outline-none ring-emerald-200 focus:ring sm:py-1.5 sm:text-xs"
          >
            {availableDates.map((date) => (
              <option key={date} value={date}>
                {date}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 sm:gap-2">
          {TAB_ITEMS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-md border px-3 py-2.5 text-[11px] font-medium sm:px-3 sm:py-1.5 sm:text-xs ${
                activeTab === tab.key
                  ? "border-slate-800 bg-slate-800 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-3">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="편명 검색 (예: KE714)"
            className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2.5 text-base outline-none ring-blue-200 focus:ring sm:py-2 sm:text-sm"
            autoComplete="off"
            enterKeyHint="search"
          />
          {!!keyword.trim() && (
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
              {searchRows.length === 0 ? (
                <p>검색 결과가 없습니다.</p>
              ) : (
                <div className="space-y-1">
                  {searchRows.map((row) => (
                    <button
                      key={row.dedupeKey}
                      type="button"
                      onClick={() => handleSearchRowClick(row.dedupeKey)}
                      className={`min-h-[44px] w-full rounded-md border-0 px-2 py-2.5 text-left text-xs leading-snug transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-400 sm:min-h-0 sm:px-1 sm:py-1 ${
                        navigateFlashKey === row.dedupeKey
                          ? "bg-sky-200/90 text-slate-900"
                          : "bg-transparent text-slate-700 hover:bg-slate-100/80"
                      }`}
                      aria-label={`${row.flight} 목록·격자에서 해당 위치로 이동`}
                    >
                      {row.flight} - {getFlightModeLabel(row.typeOfFlight)} - 시간 {row.time} - 적재대{" "}
                      {row.carousel}번
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {loading && <p className="mt-2 text-sm text-blue-600">데이터를 불러오는 중...</p>}
        {error && <p className="mt-2 text-sm text-red-600">오류: {error}</p>}
      </header>

      {displayMode === "cards" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          {visibleSlots.length === 0 ? (
            <p className="text-sm text-slate-500">표시할 항공편이 없습니다. 필터나 날짜를 바꿔 보세요.</p>
          ) : (
            <div className="space-y-6">
              {hours.map((hour) => {
                const items = cardSlotsByHour.get(hour);
                if (!items?.length) return null;
                return (
                  <section key={hour}>
                    <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold text-slate-800">
                      {hour}
                    </h2>
                    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((item) => {
                        const slotKey = getSlotDedupeKey(item);
                        const highlighted = highlightKeys.has(slotKey);
                        return (
                          <li key={slotKey}>
                            <article
                              data-baggage-slot={slotKey}
                              className={`relative flex items-center gap-1.5 rounded-lg border p-3 text-xs leading-relaxed text-slate-800 shadow-sm transition-[box-shadow,background-color] duration-200 ${highlightShellClass(
                                highlighted
                              )} ${navigateFlashKey === slotKey ? navigateFlashShellClass : ""}`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                  <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-800">
                                    적재대 {item.carousel}번
                                  </span>
                                  <span className="text-[10px] text-slate-500">
                                    터미널 {getTerminal(item.raw) || "—"}
                                  </span>
                                </div>
                                <SlotDetail item={item} />
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleHighlightKey(slotKey)}
                                className={`shrink-0 self-center sm:self-start ${highlightMarkButtonClassList}`}
                                aria-pressed={highlighted}
                                aria-label={highlighted ? "강조 해제" : "강조 표시"}
                                title={highlighted ? "강조 해제" : "강조 표시"}
                              >
                                {highlighted ? "★" : "☆"}
                              </button>
                            </article>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-100 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="격자 너비">
              <span className="text-[11px] font-medium text-slate-600 sm:text-xs">격자 너비</span>
              <button
                type="button"
                onClick={() => setTableWidthMode("fit")}
                className={`rounded-md border px-3 py-2.5 text-[11px] font-medium sm:px-2 sm:py-1 sm:text-xs ${
                  tableWidthMode === "fit"
                    ? "border-amber-700 bg-amber-700 text-white"
                    : "border-amber-200 bg-white text-amber-900 hover:bg-amber-50"
                }`}
              >
                한 화면에 맞춤
              </button>
              <button
                type="button"
                onClick={() => setTableWidthMode("scroll")}
                className={`rounded-md border px-3 py-2.5 text-[11px] font-medium sm:px-2 sm:py-1 sm:text-xs ${
                  tableWidthMode === "scroll"
                    ? "border-amber-700 bg-amber-700 text-white"
                    : "border-amber-200 bg-white text-amber-900 hover:bg-amber-50"
                }`}
              >
                가로 스크롤
              </button>
            </div>
            <p className="text-[10px] text-slate-500 sm:text-[11px]">
              {tableWidthMode === "fit"
                ? "1~20번 열을 모두 한 화면에 넣습니다. 글자가 작아지고 줄이 바뀔 수 있습니다."
                : "넓은 격자는 가로 스크롤로 보며, 시간 열은 스크롤 시에도 고정됩니다."}
            </p>
          </div>
          <div
            className={
              tableWidthMode === "fit" ? "w-full" : "touch-pan-x overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]"
            }
          >
            <table
              className={
                tableWidthMode === "fit"
                  ? "w-full min-w-0 table-fixed border-collapse text-[8px] text-slate-800 sm:text-[9px] lg:text-[10px]"
                  : "min-w-[980px] table-fixed border-collapse text-[11px] sm:min-w-[1200px] sm:text-xs lg:min-w-[1600px] xl:min-w-[1800px]"
              }
            >
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  <th
                    className={`border border-slate-200 text-center font-semibold text-slate-700 ${
                      tableWidthMode === "scroll"
                        ? "sticky left-0 z-20 w-16 bg-slate-50 px-1 py-2 sm:w-20 sm:px-2"
                        : "w-9 bg-slate-50 px-0.5 py-1 sm:w-10 sm:py-1.5"
                    }`}
                  >
                    시간
                  </th>
                  {FIXED_CAROUSELS.map((no) => (
                    <th
                      key={no}
                      className={`border border-slate-200 text-center font-semibold text-slate-700 ${
                        tableWidthMode === "fit"
                          ? "min-w-0 px-0.5 py-1 text-[9px] sm:text-[10px]"
                          : "w-32 px-1 py-2 sm:w-40 sm:px-2 lg:w-52"
                      }`}
                    >
                      {no}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hours.map((hour) => (
                  <tr key={hour}>
                    <td
                      className={`border border-slate-200 bg-slate-50 text-center font-medium text-slate-700 ${
                        tableWidthMode === "scroll"
                          ? "sticky left-0 z-10 border-r border-slate-200 bg-slate-50 px-2 py-2"
                          : "w-9 px-0.5 py-1 text-[9px] sm:w-10 sm:text-[10px]"
                      }`}
                    >
                      {hour}
                    </td>
                    {FIXED_CAROUSELS.map((carousel) => {
                      const key = `${hour}-${carousel}`;
                      const items = byHourCarousel.get(key) ?? [];
                      const compact = tableWidthMode === "fit";
                      return (
                        <td
                          key={key}
                          className={`border border-slate-200 align-top ${
                            compact ? "min-h-[52px] p-0.5 sm:min-h-[56px]" : "h-16 sm:h-20"
                          }`}
                        >
                          <div className={compact ? "space-y-0.5" : "space-y-1 p-1.5 sm:p-2"}>
                            {items.length === 0 ? (
                              <span className="text-[11px] text-slate-300" />
                            ) : (
                              items.map((item, idx) => {
                                const slotKey = getSlotDedupeKey(item);
                                const highlighted = highlightKeys.has(slotKey);
                                return (
                                  <article
                                    key={`${slotKey}#${idx}`}
                                    data-baggage-slot={slotKey}
                                    role="button"
                                    tabIndex={0}
                                    aria-pressed={highlighted}
                                    aria-label={
                                      highlighted
                                        ? `${item.flight || "항공편"} 강조 해제 (격자 칸 클릭)`
                                        : `${item.flight || "항공편"} 강조 표시 (격자 칸 클릭)`
                                    }
                                    onClick={() => toggleHighlightKey(slotKey)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        toggleHighlightKey(slotKey);
                                      }
                                    }}
                                    className={`relative cursor-pointer touch-manipulation border leading-tight text-slate-800 outline-none transition-[box-shadow,background-color] duration-200 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 ${
                                      compact
                                        ? `rounded p-0.5 ${highlightShellClass(highlighted)}`
                                        : `whitespace-pre-line rounded p-1.5 leading-4 ${highlightShellClass(
                                            highlighted
                                          )}`
                                    } ${navigateFlashKey === slotKey ? navigateFlashShellClass : ""}`}
                                  >
                                    <SlotDetail item={item} compact={compact} />
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
          </div>
        </div>
      )}
    </section>
  );
}
