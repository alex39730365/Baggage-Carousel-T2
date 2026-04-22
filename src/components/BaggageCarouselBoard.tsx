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
/** 10번·11번 캐로셀 헤더를 누르면 토글 — 10번 열 오른쪽(10↔11 사이) 빨간 가이드 */
const CAROUSEL_GUIDE_AFTER_NO = 10;
const CAROUSEL_GUIDE_TOGGLE_NOS = new Set([10, 11]);
const carouselGuideLineClass = "border-r-[3px] border-r-red-600";
const CAROUSEL_GUIDE_VISIBLE_STORAGE_KEY = "baggage-carousel-10-11-guide-v1";

const loadCarouselGuideVisible = (): boolean => {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem(CAROUSEL_GUIDE_VISIBLE_STORAGE_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    // ignore
  }
  return true;
};

const persistCarouselGuideVisible = (visible: boolean) => {
  try {
    localStorage.setItem(CAROUSEL_GUIDE_VISIBLE_STORAGE_KEY, visible ? "1" : "0");
  } catch {
    // ignore
  }
};

/** 목록(cards) 뷰에서 비어 있어도 구간은 반드시 보이게 할 시간대 */
const LIST_VIEW_ALWAYS_SHOW_HOURS = new Set(["22:00", "23:00"]);

/** 모바일 격자 보기 확대 (핀치·버튼). */
const MOBILE_GRID_ZOOM_MIN = 0.55;
const MOBILE_GRID_ZOOM_MAX = 1.85;
const clampMobileGridZoom = (z: number) =>
  Math.min(MOBILE_GRID_ZOOM_MAX, Math.max(MOBILE_GRID_ZOOM_MIN, z));
type TabKey = "all" | "terminal1" | "terminal2" | "unknown";
type DisplayMode = "cards" | "table";

/** 격자 왼쪽 모서리 헤더: 좁은 열 안에 시간·캐로셀 안내 */
function CornerHeaderCell() {
  return (
    <div className="flex w-full min-w-0 flex-col items-center justify-center gap-0.5 py-0.5 text-[7px] font-semibold leading-tight sm:text-[8px]">
      <span className="shrink-0 font-bold text-slate-950">시간</span>
      <span className="shrink-0 font-medium text-slate-600">캐로셀</span>
    </div>
  );
}

/** 격자 맨 위 캐로셀 행 */
function GridHeaderRow({
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
  // 요청사항: 웹사이트 시작 시 코드셰어 필터를 항상 켠 상태로 시작.
  return true;
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

/** 예전 키 `baggage-ke-yellow-highlight-v1`와 호환 — 설정 유지 */
const KE_PINK_HIGHLIGHT_STORAGE_KEY = "baggage-ke-pink-highlight-v1";
const KE_PINK_HIGHLIGHT_LEGACY_KEY = "baggage-ke-yellow-highlight-v1";

const loadKePinkHighlight = (): boolean => {
  if (typeof window === "undefined") return false;
  const read = (key: string): boolean | null => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch {
      // ignore
    }
    return null;
  };
  return read(KE_PINK_HIGHLIGHT_STORAGE_KEY) ?? read(KE_PINK_HIGHLIGHT_LEGACY_KEY) ?? false;
};

const persistKePinkHighlight = (on: boolean) => {
  const v = on ? "1" : "0";
  try {
    localStorage.setItem(KE_PINK_HIGHLIGHT_STORAGE_KEY, v);
    localStorage.removeItem(KE_PINK_HIGHLIGHT_LEGACY_KEY);
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

/** `KE714 / NRT`, `KE 712` 등 본편 KE(앞부분이 KE+숫자) */
const isMainlineKeFlight = (flight: string): boolean => {
  const head =
    flight
      .trim()
      .split(/\s*\/\s*/)[0]
      ?.replace(/\s+/g, "")
      .toUpperCase() ?? "";
  return /^KE\d/.test(head);
};

const kePinkShellClass = "border-pink-400/90 bg-pink-50 ring-1 ring-pink-300/60";

const slotShellClass = (starHighlighted: boolean, flight: string, kePinkOn: boolean) =>
  starHighlighted
    ? highlightShellClass(true)
    : kePinkOn && isMainlineKeFlight(flight)
      ? kePinkShellClass
      : highlightShellClass(false);

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

/** 출발(O)만 제외 — I·D·구분 없음(고정 스케줄)은 표시. */
const excludeOutboundFlights = (slots: BaggageSlot[]): BaggageSlot[] =>
  slots.filter((slot) => (slot.typeOfFlight ?? "").trim().toUpperCase() !== "O");

const TimeStandLine = ({ time, stand, compact }: { time: string; stand: string; compact?: boolean }) => (
  <p
    className={
      compact
        ? "min-w-0 max-w-full break-words leading-tight text-slate-600 [overflow-wrap:anywhere]"
        : "text-slate-600"
    }
  >
    <span className={`font-bold tabular-nums text-slate-950 ${compact ? "text-[10px] sm:text-[11px]" : "text-xs sm:text-sm"}`}>
      {time}
    </span>
    <span className={compact ? "text-slate-600" : ""}> / {stand}</span>
  </p>
);

const SlotDetail = ({ item, compact }: { item: BaggageSlot; compact?: boolean }) => {
  const timeStr = formatTime(item.estimatedTime);
  const standStr = getStand(item.raw);
  return compact ? (
    <>
      <p className="min-w-0 max-w-full break-words font-semibold leading-tight text-slate-900 [overflow-wrap:anywhere]">
        {formatFlightAirportLine(item)}
      </p>
      <TimeStandLine time={timeStr} stand={standStr} compact />
      {!!item.pieces && (
        <p className="min-w-0 max-w-full break-words leading-tight text-slate-600">
          {item.pieces.toLowerCase().includes("pc") ? item.pieces : `${item.pieces} pc`}
        </p>
      )}
    </>
  ) : (
    <>
      <p className="font-semibold text-slate-900">
        {formatFlightAirportLine(item)}
      </p>
      <TimeStandLine time={timeStr} stand={standStr} />
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
  const [hideKeCodeshareFlights, setHideKeCodeshareFlights] = useState(() => loadKeCodeshareFilter());
  const [kePinkHighlight, setKePinkHighlight] = useState(() => loadKePinkHighlight());
  const [highlightKeys, setHighlightKeys] = useState<Set<string>>(loadHighlightSet);
  const [navigateFlashKey, setNavigateFlashKey] = useState<string | null>(null);
  const navigateFlashTimerRef = useRef<number | null>(null);
  const [isMobileGridViewport, setIsMobileGridViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 639px)").matches : false
  );
  const [mobileGridZoom, setMobileGridZoom] = useState(1);
  const mobileGridZoomRef = useRef(1);
  const tablePinchWrapRef = useRef<HTMLDivElement>(null);
  const pinchGestureRef = useRef<{ dist0: number; zoom0: number } | null>(null);
  const [carouselGuideVisible, setCarouselGuideVisible] = useState(() => loadCarouselGuideVisible());

  mobileGridZoomRef.current = mobileGridZoom;

  const toggleCarouselGuide = useCallback(() => {
    setCarouselGuideVisible((prev) => {
      const next = !prev;
      persistCarouselGuideVisible(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const upd = () => setIsMobileGridViewport(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);

  useEffect(() => {
    if (displayMode !== "table" || !isMobileGridViewport) setMobileGridZoom(1);
  }, [displayMode, isMobileGridViewport]);

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
  }, [displayMode, isMobileGridViewport]);

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

  /** 격자: 마지막 행·모바일 줌이 홈 인디케이터 등에 가려지지 않게 스크롤 끝 여유 */
  const tableBottomScrollSpacerClass =
    displayMode === "table" && isMobileGridViewport
      ? "pb-[calc(5rem+env(safe-area-inset-bottom,0px))]"
      : "";

  /**
   * 래퍼에 항상 `overflow-x-auto`만 두면 브라우저가 세로 스크롤 기준을 바꿔
   * `thead`의 `sticky top-0`이 페이지가 아니라 래퍼 기준으로 깨짐 → 노란 캐로셀 줄이 안 따라옴.
   * 모바일에서 확대로 가로가 넘칠 때만 가로 스크롤을 켜고 `overflow-y-clip`으로 세로 sticky는 유지.
   */
  const gridNeedsHorizontalScroll =
    displayMode === "table" && isMobileGridViewport && mobileGridZoom > 1.001;

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
          <button
            type="button"
            aria-pressed={kePinkHighlight}
            title="켜면 KE 본편 편명(KE714, KE712 등) 칸을 핑크색으로 표시합니다."
            onClick={() =>
              setKePinkHighlight((prev) => {
                const next = !prev;
                persistKePinkHighlight(next);
                return next;
              })
            }
            className={`rounded-md border px-3 py-2.5 text-[11px] font-medium sm:px-2.5 sm:py-1.5 sm:text-xs ${
              kePinkHighlight
                ? "border-pink-500 bg-pink-400 text-pink-950"
                : "border-pink-200 bg-white text-pink-900 hover:bg-pink-50"
            }`}
          >
            KE
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
                          : kePinkHighlight && isMainlineKeFlight(row.flight)
                            ? "bg-pink-50 text-slate-900 hover:bg-pink-100/90"
                            : "bg-transparent text-slate-700 hover:bg-slate-100/80"
                      }`}
                      aria-label={`${row.flight} 목록·격자에서 해당 위치로 이동`}
                    >
                      {row.flight} — 시간{" "}
                      <span className="font-bold tabular-nums text-slate-950">{row.time}</span> — 적재대{" "}
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
                if (!items?.length && !LIST_VIEW_ALWAYS_SHOW_HOURS.has(hour)) return null;
                return (
                  <section key={hour}>
                    <h2 className="mb-2 border-b border-slate-200 pb-1 text-base font-bold tabular-nums tracking-tight text-slate-950 sm:text-lg">
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
                              className={`relative flex items-center gap-1.5 rounded-lg border p-3 text-xs leading-relaxed text-slate-800 shadow-sm transition-[box-shadow,background-color] duration-200 ${slotShellClass(
                                highlighted,
                                item.flight,
                                kePinkHighlight
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
          {isMobileGridViewport ? (
            <p className="border-b border-slate-100 bg-white px-3 py-2 text-[10px] leading-snug text-slate-400">
              격자는 두 손가락으로 벌리거나 모아 확대·축소할 수 있어요.
            </p>
          ) : null}
          <div
            className={
              gridNeedsHorizontalScroll
                ? "w-full min-w-0 overflow-x-auto overflow-y-clip [-webkit-overflow-scrolling:touch]"
                : "w-full min-w-0"
            }
          >
            <div
              ref={tablePinchWrapRef}
              className="origin-top-left align-top w-full max-w-full min-w-0 [text-size-adjust:100%] [-webkit-text-size-adjust:100%]"
              style={
                displayMode === "table" &&
                isMobileGridViewport &&
                Math.abs(mobileGridZoom - 1) >= 0.0001
                  ? /** `zoom`은 가로·세로 동일 비율. 가로만 width補正하면 세로만 커져 길쭉해 보임(Safari는 글자만 키우는 것처럼 보일 수 있어 text-size-adjust 고정). */
                    ({ zoom: mobileGridZoom } as CSSProperties)
                  : undefined
              }
            >
              <table className="w-full min-w-0 table-fixed border-collapse text-[8px] text-slate-800 sm:text-[9px] lg:text-[10px]">
              <thead className="sticky top-0 z-20 bg-slate-50 shadow-[0_1px_0_rgba(0,0,0,0.06)] ring-1 ring-slate-200/60">
                <GridHeaderRow guideVisible={carouselGuideVisible} onToggleGuide={toggleCarouselGuide} />
              </thead>
              <tbody>
                {hours.map((hour) => (
                  <tr key={hour}>
                    <td className="w-9 min-w-0 border border-slate-200 bg-slate-50 px-0.5 py-1 text-center text-[9px] font-bold tabular-nums tracking-tight text-slate-950 sm:w-10 sm:text-[10px]">
                      {hour}
                    </td>
                    {FIXED_CAROUSELS.map((carousel) => {
                      const key = `${hour}-${carousel}`;
                      const items = byHourCarousel.get(key) ?? [];
                      return (
                        <td
                          key={key}
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
                                    className={`relative min-w-0 max-w-full cursor-pointer touch-manipulation rounded border p-0.5 leading-tight text-slate-800 outline-none transition-[box-shadow,background-color] duration-200 focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 ${slotShellClass(
                                      highlighted,
                                      item.flight,
                                      kePinkHighlight
                                    )} ${navigateFlashKey === slotKey ? navigateFlashShellClass : ""}`}
                                  >
                                    <SlotDetail item={item} compact />
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
    </>
  );
}
