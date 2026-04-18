import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBaggageData } from "../hooks/useBaggageData";
import {
  collapseDuplicateFlightsPreferClassified,
  compareSlotsByEstimatedArrival,
  getSlotDedupeKey,
  getSortableMinuteOfDay,
  sanitizeFlightDisplay,
} from "../lib/baggageApi";
import { BaggageSlot } from "../types";

const HIGHLIGHT_STORAGE_KEY = "baggage-highlight-keys-v2";

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
/** 목록(cards) 뷰에서 비어 있어도 구간은 반드시 보이게 할 시간대 */
const LIST_VIEW_ALWAYS_SHOW_HOURS = new Set(["22:00", "23:00"]);

/** 모바일 격자 보기 확대 (핀치·버튼). */
const MOBILE_GRID_ZOOM_MIN = 0.55;
const MOBILE_GRID_ZOOM_MAX = 1.85;
const MOBILE_GRID_ZOOM_STEP = 0.12;
const clampMobileGridZoom = (z: number) =>
  Math.min(MOBILE_GRID_ZOOM_MAX, Math.max(MOBILE_GRID_ZOOM_MIN, z));
type TabKey = "all" | "terminal1" | "terminal2" | "unknown";
type DisplayMode = "cards" | "table";
type TableWidthMode = "scroll" | "fit";

const DISPLAY_MODE_STORAGE_KEY = "baggage-display-mode-v1";
const KE_CODESHARE_FILTER_STORAGE_KEY = "baggage-ke-codeshare-filter-v1";
/** localStorage 실패 시 같은 탭 새로고침용 보조 저장 */
const KE_CODESHARE_FILTER_SESSION_KEY = "baggage-ke-codeshare-filter-session-v1";

const loadDisplayMode = (): DisplayMode | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DISPLAY_MODE_STORAGE_KEY);
    if (raw === "cards" || raw === "table") return raw;
  } catch {
    // ignore
  }
  return null;
};

const persistDisplayMode = (mode: DisplayMode) => {
  try {
    localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
};

const loadKeCodeshareFilter = (): boolean => {
  if (typeof window === "undefined") return false;
  const read = (storage: Storage, key: string): boolean | null => {
    try {
      const raw = storage.getItem(key);
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch {
      // ignore
    }
    return null;
  };
  return read(localStorage, KE_CODESHARE_FILTER_STORAGE_KEY) ?? read(sessionStorage, KE_CODESHARE_FILTER_SESSION_KEY) ?? false;
};

const persistKeCodeshareFilter = (on: boolean) => {
  const v = on ? "1" : "0";
  try {
    localStorage.setItem(KE_CODESHARE_FILTER_STORAGE_KEY, v);
  } catch {
    // ignore
  }
  try {
    sessionStorage.setItem(KE_CODESHARE_FILTER_SESSION_KEY, v);
  } catch {
    // ignore
  }
};

/**
 * IATA 2자 + 숫자 4자리는 코드셰어 표기로 보고 숨김.(7C·KE 등 — `7C`는 앞이 숫자라 [A-Z]{2}로는 잡히지 않음)
 * 예외: KE + 4자리 + 천의 자리 2 또는 8(KE 2000, KE8178 등)만 유지.
 * 3자리·5자리 이상·패턴이 다른 편명은 그대로 둔다.
 */
const shouldKeepSlotWithKeCodeshareFilter = (flight: string): boolean => {
  const compact = flight.trim().toUpperCase().replace(/\s+/g, "");
  const m = compact.match(/^([A-Z0-9]{2})(\d+)$/);
  if (!m) return true;
  const carrier = m[1];
  const digits = m[2];
  if (digits.length !== 4) return true;
  if (carrier === "KE" && (digits[0] === "2" || digits[0] === "8")) return true;
  return false;
};

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

/** `BX165 / NRT` 처럼 편명 끝에 이미 공항 코드가 있으면 raw와 중복 표기하지 않음 */
const tailTokenFromFlight = (flight: string): string | null => {
  const parts = flight
    .trim()
    .split(/\s*\/\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1]?.toUpperCase() ?? "";
  if (!last || !/^[A-Z]{2,4}$/.test(last)) return null;
  return last;
};

const formatFlightAirportLine = (item: BaggageSlot): string => {
  const f = sanitizeFlightDisplay((item.flight || "미지정").trim());
  const code = getAirportCode(item.raw).trim();
  const tail = tailTokenFromFlight(f);
  if (code && tail && code.toUpperCase() === tail) return f;
  if (!code || code === "UNK") return f;
  return `${f} / ${code}`;
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

  /**
   * IIAC 공공데이터 여객 터미널 코드(공공데이터포털 등 기준):
   * - P01 제1여객터미널, P02 탑승동(제1 쪽 연계) → 터미널1 탭
   * - P03 제2여객터미널 → 터미널2 탭
   * (게이트 문자열에 '1' 포함 같은 추측은 쓰지 않음)
   */
  if (terminal === "P01" || terminal === "P02" || terminal === "T1" || terminal === "TERMINAL1") return "terminal1";
  if (terminal === "P03" || terminal === "T2" || terminal === "TERMINAL2") return "terminal2";

  return "unknown";
};

const filterByTab = (slots: BaggageSlot[], tab: TabKey): BaggageSlot[] => {
  if (tab === "all") return slots;
  if (tab === "terminal1") return slots.filter((slot) => getTerminalGroup(slot.raw) === "terminal1");
  if (tab === "terminal2") return slots.filter((slot) => getTerminalGroup(slot.raw) === "terminal2");
  return slots.filter((slot) => getTerminalGroup(slot.raw) === "unknown");
};

/** 공공데이터 `typeOfFlight`: O 출발, I·D 도착 등 (표시용). 없으면 빈 문자열 → UI에서 생략 */
const getFlightModeLabel = (typeOfFlight: string | undefined): string => {
  const t = (typeOfFlight ?? "").trim().toUpperCase();
  if (t === "O") return "출발";
  if (t === "I" || t === "D") return "도착";
  if (!t) return "";
  return `구분 ${t}`;
};

/** 출발(O)만 제외 — I·D·구분 없음(고정 스케줄)은 표시. */
const excludeOutboundFlights = (slots: BaggageSlot[]): BaggageSlot[] =>
  slots.filter((slot) => (slot.typeOfFlight ?? "").trim().toUpperCase() !== "O");

const SlotDetail = ({ item, compact }: { item: BaggageSlot; compact?: boolean }) => {
  const modeLabel = getFlightModeLabel(item.typeOfFlight);
  return compact ? (
    <>
      <p className="break-words font-semibold leading-tight text-slate-900">
        {formatFlightAirportLine(item)}
      </p>
      {!!modeLabel && (
        <p className="leading-tight text-[9px] text-blue-700 sm:text-[10px]">{modeLabel}</p>
      )}
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
        {formatFlightAirportLine(item)}
      </p>
      {!!modeLabel && (
        <p className="text-[10px] text-blue-700 sm:text-[11px]">{modeLabel}</p>
      )}
      <p className="text-slate-700">{`${formatTime(item.estimatedTime)} / ${getStand(item.raw)}`}</p>
      {!!item.pieces && (
        <p className="text-slate-600">
          {item.pieces.toLowerCase().includes("pc") ? item.pieces : `${item.pieces} pc`}
        </p>
      )}
    </>
  );
};

export default function BaggageCarouselBoard() {
  const { hours, loading, error, lastUpdated, slots, slotsByDate, selectedDate, setSelectedDate } =
    useBaggageData();
  const [keyword, setKeyword] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("terminal2");
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => {
    const saved = loadDisplayMode();
    if (saved) return saved;
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) return "cards";
    return "table";
  });
  /** 모바일(폭 640px 미만)은 기본 `fit` — 가로 스크롤만 쓰면 세로 스크롤이 불편한 경우가 많음 */
  const [tableWidthMode, setTableWidthMode] = useState<TableWidthMode>(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches ? "fit" : "scroll"
  );
  const [hideKeCodeshareFlights, setHideKeCodeshareFlights] = useState(() => loadKeCodeshareFilter());
  const [highlightKeys, setHighlightKeys] = useState<Set<string>>(loadHighlightSet);
  const [navigateFlashKey, setNavigateFlashKey] = useState<string | null>(null);
  const navigateFlashTimerRef = useRef<number | null>(null);
  const tableHScrollRef = useRef<HTMLDivElement>(null);
  /** 격자와 동기: 모니터 화면 맨 아래 고정 가로 스크롤 미러 */
  const tableBelowMirrorRef = useRef<HTMLDivElement>(null);
  const tableBelowMirrorInnerRef = useRef<HTMLDivElement>(null);
  const [showTableBelowHScroll, setShowTableBelowHScroll] = useState(false);
  const [isMobileGridViewport, setIsMobileGridViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 639px)").matches : false
  );
  const [mobileGridZoom, setMobileGridZoom] = useState(1);
  const mobileGridZoomRef = useRef(1);
  const tablePinchWrapRef = useRef<HTMLDivElement>(null);
  const pinchGestureRef = useRef<{ dist0: number; zoom0: number } | null>(null);

  mobileGridZoomRef.current = mobileGridZoom;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const upd = () => setIsMobileGridViewport(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);

  useEffect(() => {
    if (!isMobileGridViewport || displayMode !== "table") setMobileGridZoom(1);
  }, [isMobileGridViewport, displayMode]);

  useEffect(() => {
    return () => {
      if (navigateFlashTimerRef.current !== null) window.clearTimeout(navigateFlashTimerRef.current);
    };
  }, []);

  useEffect(() => {
    persistDisplayMode(displayMode);
  }, [displayMode]);

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

  const visibleSlots = useMemo(() => {
    let list = excludeOutboundFlights(filterByTab(slots, activeTab));
    if (hideKeCodeshareFlights) {
      list = list.filter((slot) => shouldKeepSlotWithKeCodeshareFilter(slot.flight));
    }
    return collapseDuplicateFlightsPreferClassified(list);
  }, [slots, activeTab, hideKeCodeshareFlights]);

  const measureAndSyncTableBelowMirror = useCallback(() => {
    if (displayMode !== "table" || tableWidthMode !== "scroll") {
      setShowTableBelowHScroll(false);
      return;
    }
    const main = tableHScrollRef.current;
    if (!main) {
      setShowTableBelowHScroll(false);
      return;
    }
    const inner = tablePinchWrapRef.current;
    const scrollW = Math.max(
      main.scrollWidth,
      inner ? Math.max(inner.scrollWidth, inner.offsetWidth) : 0
    );
    const mirrorInner = tableBelowMirrorInnerRef.current;
    if (mirrorInner) mirrorInner.style.width = `${scrollW}px`;
    const maxScroll = Math.max(0, scrollW - main.clientWidth);
    const show = maxScroll > 1;
    setShowTableBelowHScroll(show);
    const mirror = tableBelowMirrorRef.current;
    if (show && mirror && Math.abs(mirror.scrollLeft - main.scrollLeft) > 0.5) {
      mirror.scrollLeft = main.scrollLeft;
    }
  }, [displayMode, tableWidthMode]);

  const onTableBelowMirrorScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const main = tableHScrollRef.current;
    if (!main) return;
    main.scrollLeft = e.currentTarget.scrollLeft;
  }, []);

  useEffect(() => {
    if (displayMode !== "table" || tableWidthMode !== "scroll") {
      setShowTableBelowHScroll(false);
      return;
    }
    const main = tableHScrollRef.current;
    const inner = tablePinchWrapRef.current;
    if (!main) return;

    const run = () => requestAnimationFrame(() => measureAndSyncTableBelowMirror());
    run();

    const onMainScroll = () => {
      const mirror = tableBelowMirrorRef.current;
      if (!mirror) return;
      if (Math.abs(mirror.scrollLeft - main.scrollLeft) > 0.5) mirror.scrollLeft = main.scrollLeft;
    };
    main.addEventListener("scroll", onMainScroll, { passive: true });

    const ro = new ResizeObserver(run);
    ro.observe(main);
    if (inner) ro.observe(inner);

    window.addEventListener("resize", run);
    return () => {
      main.removeEventListener("scroll", onMainScroll);
      window.removeEventListener("resize", run);
      ro.disconnect();
    };
  }, [displayMode, tableWidthMode, measureAndSyncTableBelowMirror, visibleSlots, mobileGridZoom]);

  useEffect(() => {
    if (!isMobileGridViewport || displayMode !== "table") return;
    const el = tablePinchWrapRef.current;
    if (!el) return;

    const touchDist = (e: TouchEvent) => {
      if (e.touches.length < 2) return 0;
      const a = e.touches[0];
      const b = e.touches[1];
      return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const d = touchDist(e);
        if (d > 1) pinchGestureRef.current = { dist0: d, zoom0: mobileGridZoomRef.current };
      }
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchGestureRef.current) return;
      const d = touchDist(e);
      if (d <= 1) return;
      const z = clampMobileGridZoom(
        pinchGestureRef.current.zoom0 * (d / pinchGestureRef.current.dist0)
      );
      e.preventDefault();
      setMobileGridZoom(z);
    };

    const onEnd = () => {
      pinchGestureRef.current = null;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [isMobileGridViewport, displayMode]);

  const byHourCarousel = useMemo(() => {
    const map = new Map<string, BaggageSlot[]>();
    for (const slot of visibleSlots) {
      const key = `${slot.hour}-${slot.carousel}`;
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort(compareSlotsByEstimatedArrival);
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
        sortMin: getSortableMinuteOfDay(slot),
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
      .sort(
        (a, b) =>
          a.sortMin - b.sortMin ||
          a.carousel - b.carousel ||
          `${a.hour}-${a.flight}`.localeCompare(`${b.hour}-${b.flight}`)
      )
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
      const list = [...inner.values()].sort(compareSlotsByEstimatedArrival);
      out.set(hour, list);
    }
    return out;
  }, [visibleSlots]);

  /** 격자: 마지막 행(23시)·모바일 줌이 홈 인디케이터·하단 고정 가로 스크롤에 가려지지 않게 스크롤 끝 여유 */
  const tableBottomScrollSpacerClass =
    displayMode === "table" && (isMobileGridViewport || showTableBelowHScroll)
      ? showTableBelowHScroll
        ? "pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))]"
        : "pb-[calc(5rem+env(safe-area-inset-bottom,0px))]"
      : "";

  return (
    <>
    <section className={`space-y-3 sm:space-y-4 ${tableBottomScrollSpacerClass}`}>
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

        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="코드셰어 편명 정리">
          <span className="text-[11px] font-medium text-slate-600 sm:text-xs">편명</span>
          <button
            type="button"
            aria-pressed={hideKeCodeshareFlights}
            title="켜면 7C·AF 등 2자+숫자 4자리는 숨기고, KE 2xxx·KE 8xxx만 예외로 남깁니다."
            onClick={() =>
              setHideKeCodeshareFlights((prev) => {
                const next = !prev;
                persistKeCodeshareFilter(next);
                return next;
              })
            }
            className={`rounded-md border px-3 py-2.5 text-[11px] font-medium sm:px-2.5 sm:py-1.5 sm:text-xs ${
              hideKeCodeshareFlights
                ? "border-violet-700 bg-violet-700 text-white"
                : "border-violet-200 bg-white text-violet-900 hover:bg-violet-50"
            }`}
          >
            코드셰어
          </button>
          {hideKeCodeshareFlights ? (
            <span className="text-[10px] text-slate-500 sm:text-[11px]">
              7C/XX 4자리 숨김 · KE 2xxx·8xxx만 표시
            </span>
          ) : (
            <span className="text-[10px] text-slate-400 sm:text-[11px]">2글자+4자리 편 전부 표시</span>
          )}
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
                  {searchRows.map((row) => {
                    const mode = getFlightModeLabel(row.typeOfFlight);
                    return (
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
                      {row.flight}
                      {mode ? ` - ${mode}` : ""} - 시간 {row.time} - 적재대 {row.carousel}번
                    </button>
                    );
                  })}
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
                if (!items?.length && !LIST_VIEW_ALWAYS_SHOW_HOURS.has(hour)) return null;
                return (
                  <section key={hour}>
                    <h2 className="mb-2 border-b border-slate-200 pb-1 text-sm font-semibold text-slate-800">
                      {hour}
                    </h2>
                    {!items?.length ? (
                      <p className="text-sm text-slate-500">이 시간대에 표시할 항공편이 없습니다.</p>
                    ) : (
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
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-slate-100 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div
              className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-1.5"
              role="group"
              aria-label="격자 너비"
            >
              <span className="shrink-0 text-[11px] font-medium text-slate-600 sm:text-xs">격자 너비</span>
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:gap-1.5">
                <button
                  type="button"
                  onClick={() => setTableWidthMode("fit")}
                  title="20개 적재대 열을 화면 너비에 맞춥니다. 글자·칸이 작아질 수 있습니다."
                  className={`min-w-0 rounded-md border px-2 py-2.5 text-center text-[11px] font-medium leading-snug sm:px-2 sm:py-1 sm:text-xs ${
                    tableWidthMode === "fit"
                      ? "border-amber-700 bg-amber-700 text-white"
                      : "border-amber-200 bg-white text-amber-900 hover:bg-amber-50"
                  }`}
                >
                  전체 맞춤
                </button>
                <button
                  type="button"
                  onClick={() => setTableWidthMode("scroll")}
                  title="열 너비를 고정하고 가로로 밀어 봅니다. 왼쪽 시간 열은 고정됩니다."
                  className={`min-w-0 rounded-md border px-2 py-2.5 text-center text-[11px] font-medium leading-snug sm:px-2 sm:py-1 sm:text-xs ${
                    tableWidthMode === "scroll"
                      ? "border-amber-700 bg-amber-700 text-white"
                      : "border-amber-200 bg-white text-amber-900 hover:bg-amber-50"
                  }`}
                >
                  가로 보기
                </button>
              </div>
            </div>
            <p className="hidden text-[10px] text-slate-500 sm:block sm:text-[11px]">
              {tableWidthMode === "fit"
                ? "전체 맞춤: 20열을 한 화면에 넣습니다. 글자·칸이 작아질 수 있습니다."
                : "가로 보기: 화면 맨 아래 고정 가로 스크롤바로 좌우 이동합니다. 시간 열은 고정입니다."}
            </p>
            <p className="text-[10px] leading-snug text-slate-500 sm:hidden">
              {tableWidthMode === "fit"
                ? "20열을 한 화면에. 글자·칸이 작아질 수 있어요."
                : "가로로 밀어 넓게 봐요. 화면 밑 고정 스크롤로 좌우 이동. 왼쪽 시간 열만 고정돼요."}
            </p>
          </div>
          {isMobileGridViewport ? (
            <div
              className="flex flex-col gap-1.5 border-b border-slate-100 bg-white px-3 py-2 sm:hidden"
              role="group"
              aria-label="격자 확대·축소"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-slate-600">보기 크기</span>
                <div className="flex min-h-[44px] flex-1 items-center justify-end gap-1.5">
                  <button
                    type="button"
                    className="flex h-11 min-w-[44px] items-center justify-center rounded-md border border-slate-300 bg-white text-lg font-semibold text-slate-800 active:bg-slate-100 disabled:opacity-40"
                    aria-label="격자 축소"
                    disabled={mobileGridZoom <= MOBILE_GRID_ZOOM_MIN + 0.001}
                    onClick={() =>
                      setMobileGridZoom((z) => clampMobileGridZoom(z - MOBILE_GRID_ZOOM_STEP))
                    }
                  >
                    −
                  </button>
                  <span className="min-w-[3.25rem] text-center text-xs font-semibold tabular-nums text-slate-800">
                    {Math.round(mobileGridZoom * 100)}%
                  </span>
                  <button
                    type="button"
                    className="flex h-11 min-w-[44px] items-center justify-center rounded-md border border-slate-300 bg-white text-lg font-semibold text-slate-800 active:bg-slate-100 disabled:opacity-40"
                    aria-label="격자 확대"
                    disabled={mobileGridZoom >= MOBILE_GRID_ZOOM_MAX - 0.001}
                    onClick={() =>
                      setMobileGridZoom((z) => clampMobileGridZoom(z + MOBILE_GRID_ZOOM_STEP))
                    }
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-2 text-[11px] font-medium text-indigo-900 active:bg-indigo-100"
                    aria-label="보기 크기 초기화"
                    onClick={() => setMobileGridZoom(1)}
                  >
                    100%
                  </button>
                </div>
              </div>
              <p className="text-[10px] leading-snug text-slate-400">
                두 손가락으로 벌리거나 모으면 핀치로도 조절할 수 있어요.
              </p>
            </div>
          ) : null}
          <div
            ref={tableHScrollRef}
            className={
              tableWidthMode === "fit"
                ? "w-full"
                : "[touch-action:pan-x_pan-y] overflow-x-auto overscroll-x-contain pb-1 [-webkit-overflow-scrolling:touch] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            }
          >
            <div
              ref={tablePinchWrapRef}
              className={`origin-top-left align-top ${
                tableWidthMode === "scroll" ? "inline-block w-max max-w-none" : ""
              }`}
              style={
                isMobileGridViewport && displayMode === "table"
                  ? ({ zoom: mobileGridZoom } as CSSProperties)
                  : undefined
              }
            >
              <table
                className={
                  tableWidthMode === "fit"
                    ? "w-full min-w-0 table-fixed border-collapse text-[8px] text-slate-800 sm:text-[9px] lg:text-[10px]"
                    : "min-w-[680px] table-fixed border-collapse text-[10px] sm:min-w-[760px] sm:text-[11px] md:min-w-[820px] lg:min-w-[880px]"
                }
              >
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr>
                  <th
                    className={`border border-slate-200 text-center font-semibold text-slate-700 ${
                      tableWidthMode === "scroll"
                        ? "sticky left-0 z-20 w-14 shrink-0 bg-slate-50 px-1 py-1.5 sm:w-16 sm:px-1.5 sm:py-2"
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
                          : "w-24 shrink-0 px-0.5 py-1.5 sm:w-28 sm:px-1 sm:py-2 md:w-32 md:px-1.5"
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
                            compact ? "min-h-[52px] p-0.5 sm:min-h-[56px]" : "h-14 sm:h-16"
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
        </div>
      )}
    </section>
    {displayMode === "table" && tableWidthMode === "scroll" ? (
      <div
        className={
          showTableBelowHScroll
            ? "pointer-events-auto fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/95 px-2 py-1.5 pb-[calc(0.35rem+env(safe-area-inset-bottom,0px))] shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur-sm"
            : "pointer-events-none fixed bottom-0 left-0 right-0 z-50 h-0 overflow-hidden border-0 p-0 opacity-0 shadow-none"
        }
        role="presentation"
        aria-hidden
      >
        <div
          ref={tableBelowMirrorRef}
          onScroll={onTableBelowMirrorScroll}
          className="mx-auto flex w-full max-w-[1900px] min-h-10 [touch-action:pan-x_pan-y] items-end overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] [scrollbar-color:rgb(148_163_184)_rgb(241_245_249)] [scrollbar-width:thin] sm:min-h-2 [&::-webkit-scrollbar]:h-3.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-200/90"
        >
          <div ref={tableBelowMirrorInnerRef} className="h-2 shrink-0" />
        </div>
      </div>
    ) : null}
    </>
  );
}
