import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBaggageData } from "../hooks/useBaggageData";
import {
  compareSlotsByEstimatedArrival,
  diffMinutesArrivalToLastBaggage,
  getSlotDedupeKey,
  getSortableMinuteOfDay,
  isBagLastTimePassed,
  RAW_ACTUAL_ARRIVAL_KEYS,
  RAW_BAG_FIRST_TIME_KEYS,
  RAW_BAG_LAST_TIME_KEYS,
  RAW_STAND_KEYS,
  RAW_STATUS_KEYS,
  sanitizeFlightDisplay,
} from "../lib/baggageApi";
import { shouldKeepSlotWithKeCodeshareFilter } from "../lib/keCodeshareFilter";
import { DashboardControlStack } from "../dashboard/DashboardControlStack";
import type { DisplayMode, TabKey } from "../dashboard/controlTypes";
import type { BaggageSlot } from "../types";
import { CarouselDataGrid } from "./CarouselDataGrid";
import { DashboardHelpDialog } from "./DashboardHelpDialog";

/** 목록·시트·호버 팝오버 쌓임
 *  수하물 처리 시간 호버 창이 목록 안에서는 항상 최상단(툴바·시간대 줄·이웃 카드 위).
 *  전역 시트(이용 안내 등)는 z-90+ 유지. */
const Z_LIST_CARD_BASE = "z-0";
/** 호버 팝오버 열린 카드 — 툴바(z-50)보다 위 */
const Z_LIST_CARD_POPOVER_ACTIVE = "z-[60]";
const Z_LIST_TOOLBAR = "z-50";
const Z_LIST_HOVER_POPOVER = "z-[61]";
const Z_SHEET_BACKDROP = "z-[90]";
const Z_SHEET_PANEL = "z-[100]";
/** 목록 상단 스티키 바 높이 — 시간대 제목 `sticky top`과 동일 값 */
const LIST_STICKY_TOOLBAR_HEIGHT = "2.75rem";

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

/** 목록·격자 카드 공통: 테두리+배경 (비강조는 기존과 비슷한 톤).
 *  - KE 본편 자동(파랑)·KE 클릭(분홍)과 겹치지 않게
 *    클릭 강조는 violet(보라) 계열로 두툼하게(ring-2). */
const highlightShellClass = (on: boolean) =>
  on
    ? "border-violet-500 bg-violet-50 ring-2 ring-violet-400/80"
    : "border-slate-200 bg-white";

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

/** 편명 검색에서 줄·해당 슬롯을 잠깐 강조할 때 (약 2초, 분홍). */
const NAVIGATE_FLASH_MS = 2000;
const navigateFlashShellClass =
  "z-[1] bg-pink-100 ring-4 ring-pink-400 shadow-[0_0_14px_rgba(236,72,153,0.55)]";

const CAROUSEL_GUIDE_VISIBLE_STORAGE_KEY = "baggage-carousel-10-11-guide-v2";

const loadCarouselGuideVisible = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(CAROUSEL_GUIDE_VISIBLE_STORAGE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // ignore
  }
  return false;
};

const persistCarouselGuideVisible = (visible: boolean) => {
  try {
    localStorage.setItem(CAROUSEL_GUIDE_VISIBLE_STORAGE_KEY, visible ? "1" : "0");
  } catch {
    // ignore
  }
};

/** 목록(cards) 뷰에서 비어 있어도 시간대 제목·안내가 보이게 할 구간(14시~23시) */
const LIST_VIEW_ALWAYS_SHOW_HOURS = new Set(
  Array.from({ length: 10 }, (_, i) => `${String(14 + i).padStart(2, "0")}:00`)
);

/** 모바일 격자 보기 확대/축소 (핀치). */
const MOBILE_GRID_ZOOM_MIN = 0.25;
const MOBILE_GRID_ZOOM_MAX = 1.85;
const clampMobileGridZoom = (z: number) =>
  Math.min(MOBILE_GRID_ZOOM_MAX, Math.max(MOBILE_GRID_ZOOM_MIN, z));
const isGridTableMode = (m: DisplayMode) => m === "table" || m === "processing";

const LIST_PROCESSING_HOVER_KEY = "baggage-list-processing-hover-v1";

const loadListProcessingHoverPopover = (): boolean => {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem(LIST_PROCESSING_HOVER_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    // ignore
  }
  return true;
};

const persistListProcessingHoverPopover = (enabled: boolean) => {
  try {
    localStorage.setItem(LIST_PROCESSING_HOVER_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
};

const DISPLAY_MODE_SESSION_KEY = "baggage-display-mode-session-v1";

const loadDisplayMode = (): DisplayMode | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(DISPLAY_MODE_SESSION_KEY);
    if (raw === "cards" || raw === "table" || raw === "processing") return raw;
  } catch {
    // ignore
  }
  return null;
};

const persistDisplayMode = (mode: DisplayMode) => {
  try {
    sessionStorage.setItem(DISPLAY_MODE_SESSION_KEY, mode);
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
  // 저장값 없을 때 기본 ON — KE 본편 파랑 강조. (Cursor 단순 미리보기와 Chrome 등은 localStorage가 달라 한쪽만 켜진 것처럼 보일 수 있음)
  return read(KE_PINK_HIGHLIGHT_STORAGE_KEY) ?? read(KE_PINK_HIGHLIGHT_LEGACY_KEY) ?? true;
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

/** KE 본편 — 자동 강조(파랑). 뷰포트·미리보기 창 너비와 무관하게 격자에서도 보이도록 한 톤으로 통일 */
const keBlueShellClass =
  "border-blue-500 bg-blue-100 ring-2 ring-blue-400/80";
/** KE 본편 — 별·격자 클릭으로 켠 강조(분홍). 파란 자동 강조와 동일한 굵기로 시각 우선순위 유지 */
const keStarKeShellClass = "border-pink-500 bg-pink-100 ring-2 ring-pink-400/80";

/** 마지막 수하물(L) 시각 경과 — 항공편 칸 회색(내부 글자는 `index.css` `.last-bag-past-cell`) */
const lastBagPastShellClass = "last-bag-past-cell border-slate-300 ring-1 ring-slate-200";
/** L 경과 + KE 본편 — 연한 파랑(`index.css` `.ke-last-bag-past-cell`) */
const keLastBagPastShellClass = "ke-last-bag-past-cell border-blue-200 ring-1 ring-blue-200/80";

const slotShellClass = (
  starHighlighted: boolean,
  flight: string,
  kePinkOn: boolean,
  lastBaggagePast: boolean
) =>
  starHighlighted
    ? isMainlineKeFlight(flight)
      ? keStarKeShellClass
      : highlightShellClass(true)
    : lastBaggagePast
      ? isMainlineKeFlight(flight)
        ? keLastBagPastShellClass
        : lastBagPastShellClass
      : kePinkOn && isMainlineKeFlight(flight)
        ? keBlueShellClass
        : highlightShellClass(false);

const formatTime = (value: string) => {
  const compact = value.replace(/\D/g, "");
  if (compact.length >= 12) return `${compact.slice(8, 10)}:${compact.slice(10, 12)}`;
  const match = value.match(/(\d{2}:\d{2})/);
  return match ? match[1] : value;
};

const pickRawString = (raw: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) {
      const s = String(Math.trunc(v));
      if (s.replace(/\D/g, "").length >= 8) return s;
    }
  }
  return "";
};

const hasActualArrival = (item: BaggageSlot): boolean => {
  const raw = item.raw as Record<string, unknown>;
  const actualArrival = pickRawString(raw, [...RAW_ACTUAL_ARRIVAL_KEYS]);
  if (actualArrival) return true;
  const statusText = [item.status, pickRawString(raw, [...RAW_STATUS_KEYS])]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  return /도착|ARRIV|LANDED/.test(statusText);
};

/** 첫·마지막 벨트 시각 중 하나라도 있으면(진행 중 포함) 처리 시간 탭·ⓘ 등에서 의미 있음 */
const hasBaggageProcessingTimes = (item: BaggageSlot): boolean => {
  const raw = item.raw as Record<string, unknown>;
  return (
    Boolean(pickRawString(raw, [...RAW_BAG_FIRST_TIME_KEYS])) ||
    Boolean(pickRawString(raw, [...RAW_BAG_LAST_TIME_KEYS]))
  );
};

/** 수하물 처리 시간: 편명 / 공항 코드 / ETA(or ATA) / F(표시만) / L — 소요 분은 도착 시각~L만 사용 */
const getProcessingParts = (item: BaggageSlot) => {
  const fullFlight = sanitizeFlightDisplay((item.flight || "미지정").trim());
  const flight = fullFlight.split(/\s*\/\s*/)[0]?.trim() || "미지정";
  const tail = tailTokenFromFlight(fullFlight);
  const code = getAirportCode(item.raw).trim();
  const airportCode = code && code !== "UNK" && code.toUpperCase() !== tail ? code : "";
  const arrivalLabel: "ATA" | "ETA" = hasActualArrival(item) ? "ATA" : "ETA";
  const atRaw = (item.estimatedTime || "").trim();
  const at = (formatTime(atRaw) || "").trim() || "—";
  const raw = item.raw as Record<string, unknown>;
  const firstRaw = pickRawString(raw, [...RAW_BAG_FIRST_TIME_KEYS]);
  const lastRaw = pickRawString(raw, [...RAW_BAG_LAST_TIME_KEYS]);
  const hasFirst = Boolean(firstRaw.trim());
  const hasLast = Boolean(lastRaw.trim());
  const f = hasFirst ? formatTime(firstRaw) : "";
  const l = hasLast ? formatTime(lastRaw) : "";
  return { flight, airportCode, arrivalLabel, at, f, l, lastRaw, hasFirst, hasLast };
};

const ProcessingLines = ({
  flight,
  airportCode,
  arrivalLabel,
  at,
  f,
  l,
  hasFirst,
  hasLast,
  compact,
}: {
  flight: string;
  airportCode: string;
  arrivalLabel: "ATA" | "ETA";
  at: string;
  f: string;
  l: string;
  hasFirst: boolean;
  hasLast: boolean;
  compact: boolean;
}) => {
  const row = compact ? "text-[10px] leading-tight" : "text-sm leading-snug";
  return (
    <div className={`min-w-0 max-w-full space-y-0.5 font-bold tabular-nums text-slate-950 [overflow-wrap:anywhere] ${row}`}>
      <p title={flight} className="block w-full max-w-full whitespace-nowrap [overflow-wrap:normal]">
        {flight}
      </p>
      {airportCode ? (
        <p
          title={airportCode}
          className={`block w-full max-w-full truncate ${compact ? "text-[9px] leading-tight" : "text-xs"} text-slate-500`}
        >
          {airportCode}
        </p>
      ) : null}
      <p>
        {arrivalLabel} {at}
      </p>
      {hasFirst && f ? (
        <p>
          F {f}
        </p>
      ) : null}
      {hasLast && l ? (
        <p>
          L {l}
        </p>
      ) : null}
    </div>
  );
};

const ProcessingSlotDetail = ({
  item,
  compact,
  abbrevLegend,
}: {
  item: BaggageSlot;
  compact?: boolean;
  /** ATA/F/L 영문 설명 — 시트 등에서만 사용 */
  abbrevLegend?: boolean;
}) => {
  const { flight, airportCode, arrivalLabel, at, f, l, lastRaw, hasFirst, hasLast } = getProcessingParts(item);
  const minutes = diffMinutesArrivalToLastBaggage(
    (item.estimatedTime || "").trim(),
    lastRaw,
    item.date
  );
  return compact ? (
    <>
      <ProcessingLines
        flight={flight}
        airportCode={airportCode}
        arrivalLabel={arrivalLabel}
        at={at}
        f={f}
        l={l}
        hasFirst={hasFirst}
        hasLast={hasLast}
        compact
      />
      {minutes != null && (
        <p className="pt-0.5 text-[9px] font-semibold tabular-nums text-indigo-700">소요 {minutes}분</p>
      )}
    </>
  ) : (
    <>
      <ProcessingLines
        flight={flight}
        airportCode={airportCode}
        arrivalLabel={arrivalLabel}
        at={at}
        f={f}
        l={l}
        hasFirst={hasFirst}
        hasLast={hasLast}
        compact={false}
      />
      {minutes != null && <p className="mt-1 text-sm font-semibold text-indigo-700">소요 {minutes}분</p>}
      {abbrevLegend ? (
        <div className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-slate-500">
          <p>ETA/ATA = 도착 예정/실제 시각</p>
          <p>F = First baggage (ETA/ATA와 L 사이 참고 표시)</p>
          <p>L = Last baggage</p>
          <p className="pt-0.5">소요 시간은 도착 시각부터 L까지 (F는 계산에 미포함)</p>
        </div>
      ) : null}
    </>
  );
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
  const s = pickRawString(raw, [...RAW_STAND_KEYS]);
  if (s) return s;
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

const EmptyState = ({ message }: { message: string }) => (
  <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center">
    <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-white text-sm font-semibold text-slate-500">
      i
    </div>
    <p className="text-sm text-slate-600">{message}</p>
  </div>
);

const SlotDetail = ({
  item,
  compact,
  flightLineClassName,
}: {
  item: BaggageSlot;
  compact?: boolean;
  /** 목록 등: 편명 줄에 `cursor-help` 등 */
  flightLineClassName?: string;
}) => {
  const timeStr = formatTime(item.estimatedTime);
  const standStr = getStand(item.raw);
  const flightLineText = formatFlightAirportLine(item);
  const flightOnly = sanitizeFlightDisplay((item.flight || "미지정").trim());
  const airportSuffix =
    flightLineText !== flightOnly ? flightLineText.replace(flightOnly, "").trim() : "";
  const flightLineExtra = flightLineClassName?.trim() ? ` ${flightLineClassName.trim()}` : "";
  return compact ? (
    <>
      <p
        title={flightLineText}
        className={`block w-full max-w-full whitespace-nowrap text-[11px] font-bold leading-tight text-slate-950 [overflow-wrap:normal]${flightLineExtra}`}
      >
        {flightOnly}
      </p>
      {airportSuffix ? (
        <p className="block w-full max-w-full truncate text-[9px] leading-tight text-slate-500">
          {airportSuffix.replace(/^\/\s*/, "")}
        </p>
      ) : null}
      <TimeStandLine time={timeStr} stand={standStr} compact />
      {!!item.pieces && (
        <p className="min-w-0 max-w-full break-words leading-tight text-slate-600">
          {item.pieces.toLowerCase().includes("pc") ? item.pieces : `${item.pieces} pc`}
        </p>
      )}
    </>
  ) : (
    <>
      <p
        title={flightLineText}
        className={`min-w-0 max-w-full break-words text-sm font-bold text-slate-950 line-clamp-3 [overflow-wrap:anywhere] sm:line-clamp-none${flightLineExtra}`}
      >
        {flightLineText}
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
  const {
    hours,
    loading,
    error,
    refreshError,
    lastUpdated,
    slots,
    slotsByDate,
    selectedDate,
    setSelectedDate,
  } = useBaggageData();
  const [keyword, setKeyword] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("terminal2");
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => loadDisplayMode() ?? "table");
  const [kePinkHighlight] = useState(() => loadKePinkHighlight());
  const [highlightKeys, setHighlightKeys] = useState<Set<string>>(loadHighlightSet);
  const [navigateFlashKey, setNavigateFlashKey] = useState<string | null>(null);
  const navigateFlashTimerRef = useRef<number | null>(null);
  /** 목록: 항공편(편명 블록) 호버 시 위쪽에 뜨는 수하물 처리 시간 작은 창 */
  const [listProcessingHoverPopover, setListProcessingHoverPopover] = useState(
    () => loadListProcessingHoverPopover()
  );
  const [processingPopoverSlotKey, setProcessingPopoverSlotKey] = useState<string | null>(null);
  const processingPopoverLeaveTimerRef = useRef<number | null>(null);
  /** (hover: none) — 터치 위주 기기에서 목록 카드 ⓘ 시트 */
  const [prefersNoHover, setPrefersNoHover] = useState(false);
  const [listProcessingSheetSlotKey, setListProcessingSheetSlotKey] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [isMobileGridViewport, setIsMobileGridViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 639px)").matches : false
  );
  const [mobileGridZoom, setMobileGridZoom] = useState(1);
  const mobileGridZoomRef = useRef(1);
  const prevDisplayModeRef = useRef<DisplayMode>(displayMode);
  const tablePinchWrapRef = useRef<HTMLDivElement>(null);
  const pinchGestureRef = useRef<{ dist0: number; zoom0: number } | null>(null);
  const [carouselGuideVisible, setCarouselGuideVisible] = useState(() => loadCarouselGuideVisible());
  /** L 시각 경과 등 벽시계 비교 — 최대 ~15초 지연으로 전환(브라우저 부담은 작게 유지) */
  const [nowMs, setNowMs] = useState(() => Date.now());
  mobileGridZoomRef.current = mobileGridZoom;

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

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
    if (!isGridTableMode(displayMode)) setMobileGridZoom(1);
  }, [displayMode]);

  const cancelProcessingPopoverLeaveTimer = useCallback(() => {
    const t = processingPopoverLeaveTimerRef.current;
    if (t !== null) {
      window.clearTimeout(t);
      processingPopoverLeaveTimerRef.current = null;
    }
  }, []);

  const openProcessingPopover = useCallback(
    (key: string) => {
      if (!listProcessingHoverPopover) return;
      cancelProcessingPopoverLeaveTimer();
      setProcessingPopoverSlotKey(key);
    },
    [cancelProcessingPopoverLeaveTimer, listProcessingHoverPopover]
  );

  const scheduleCloseProcessingPopover = useCallback(() => {
    cancelProcessingPopoverLeaveTimer();
    processingPopoverLeaveTimerRef.current = window.setTimeout(() => {
      setProcessingPopoverSlotKey(null);
      processingPopoverLeaveTimerRef.current = null;
    }, 220);
  }, [cancelProcessingPopoverLeaveTimer]);

  useEffect(() => {
    return () => {
      if (navigateFlashTimerRef.current !== null) window.clearTimeout(navigateFlashTimerRef.current);
      cancelProcessingPopoverLeaveTimer();
    };
  }, [cancelProcessingPopoverLeaveTimer]);

  useEffect(() => {
    if (displayMode !== "cards") {
      cancelProcessingPopoverLeaveTimer();
      setProcessingPopoverSlotKey(null);
      setListProcessingSheetSlotKey(null);
    }
  }, [displayMode, cancelProcessingPopoverLeaveTimer]);

  useEffect(() => {
    const mq = window.matchMedia("(hover: none)");
    const sync = () => setPrefersNoHover(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (listProcessingSheetSlotKey) {
        e.preventDefault();
        setListProcessingSheetSlotKey(null);
        return;
      }
      if (processingPopoverSlotKey) {
        e.preventDefault();
        cancelProcessingPopoverLeaveTimer();
        setProcessingPopoverSlotKey(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [listProcessingSheetSlotKey, processingPopoverSlotKey, cancelProcessingPopoverLeaveTimer]);

  useEffect(() => {
    persistDisplayMode(displayMode);
  }, [displayMode]);

  useEffect(() => {
    persistListProcessingHoverPopover(listProcessingHoverPopover);
  }, [listProcessingHoverPopover]);

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
    /** 코드셰어 표기 숨김 — 항상 적용(요청사항) */
    list = list.filter((slot) => shouldKeepSlotWithKeCodeshareFilter(slot.flight));
    // 화면 단계에서는 같은 편명 슬롯을 강제 1개로 줄이지 않는다.
    // 그래야 API 갱신으로 시간/적재대가 이동할 때 실제 이동이 그대로 보인다.
    return list.sort(compareSlotsByEstimatedArrival);
  }, [slots, activeTab]);

  const listSheetSlotItem = useMemo(() => {
    if (!listProcessingSheetSlotKey) return null;
    return visibleSlots.find((s) => getSlotDedupeKey(s) === listProcessingSheetSlotKey) ?? null;
  }, [listProcessingSheetSlotKey, visibleSlots]);

  useEffect(() => {
    if (!isMobileGridViewport || !isGridTableMode(displayMode)) return;
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

  const getCurrentSeoulHourKey = useCallback((): string => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
    return `${hh}:00`;
  }, []);

  const findNearestHourWithItems = useCallback(
    (startHour: string): string | null => {
      const idx = hours.indexOf(startHour);
      if (idx < 0) return hours.find((h) => (cardSlotsByHour.get(h)?.length ?? 0) > 0) ?? null;
      for (let i = 0; i < hours.length; i++) {
        const next = hours[(idx + i) % hours.length];
        if ((cardSlotsByHour.get(next)?.length ?? 0) > 0) return next;
      }
      return null;
    },
    [hours, cardSlotsByHour]
  );

  /** 목록에서 시간대 순 첫 카드 — 스티키 줄 바로 아래라 툴팁이 닿기 쉬움 → 살짝 아래로 밀어 간격 확보 */
  const firstListCardSlotKey = useMemo(() => {
    for (const hour of hours) {
      const items = cardSlotsByHour.get(hour);
      if (!items?.length) {
        if (!LIST_VIEW_ALWAYS_SHOW_HOURS.has(hour)) continue;
        continue;
      }
      return getSlotDedupeKey(items[0]!);
    }
    return null;
  }, [hours, cardSlotsByHour]);

  useEffect(() => {
    const prev = prevDisplayModeRef.current;
    prevDisplayModeRef.current = displayMode;
    if (!isMobileGridViewport) return;
    if (prev === "cards" || displayMode !== "cards") return;

    const targetHour = findNearestHourWithItems(getCurrentSeoulHourKey());
    if (!targetHour) return;

    const id = window.setTimeout(() => {
      const safe = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(targetHour) : targetHour;
      const el = document.querySelector(`[data-hour-section="${safe}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 60);
    return () => window.clearTimeout(id);
  }, [displayMode, isMobileGridViewport, getCurrentSeoulHourKey, findNearestHourWithItems]);

  /** 격자: 마지막 행·모바일 줌이 홈 인디케이터 등에 가려지지 않게 스크롤 끝 여유 */
  const tableBottomScrollSpacerClass =
    isGridTableMode(displayMode) && isMobileGridViewport
      ? "pb-[calc(5rem+env(safe-area-inset-bottom,0px))]"
      : "";

  /**
   * 래퍼에 항상 `overflow-x-auto`만 두면 브라우저가 세로 스크롤 기준을 바꿔
   * `thead`의 `sticky top-0`이 페이지가 아니라 래퍼 기준으로 깨짐 → 노란 캐로셀 줄이 안 따라옴.
   * 모바일에서 확대로 가로가 넘칠 때만 가로 스크롤을 켜고 `overflow-y-clip`으로 세로 sticky는 유지.
   */
  /**
   * 줌 < 1 : CSS `zoom`으로 레이아웃 자체를 축소(가로 스크롤 자동 사라짐)
   * 줌 > 1 : `transform: scale`로 시각만 확대(픽셀 보정 위해)
   */
  const gridZoomBelow1 = isGridTableMode(displayMode) && mobileGridZoom < 0.999;
  const gridNeedsHorizontalScroll =
    isGridTableMode(displayMode) &&
    !gridZoomBelow1 &&
    (isMobileGridViewport || mobileGridZoom > 1.001);
  const gridScaleStyle = !isGridTableMode(displayMode)
    ? undefined
    : gridZoomBelow1
      ? ({ zoom: mobileGridZoom } as CSSProperties)
      : Math.abs(mobileGridZoom - 1) >= 0.0001
        ? ({ transform: `scale(${mobileGridZoom})`, transformOrigin: "top left" } as CSSProperties)
        : undefined;

  return (
    <>
    <section className={`space-y-3 sm:space-y-4 ${tableBottomScrollSpacerClass}`}>
      <header className="space-y-6 sm:space-y-7">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 text-left">
            <h1 className="text-xl font-bold tracking-tight text-[#1e40af] sm:text-2xl">수하물 케로셀 현황판</h1>
            <p className="mt-2 text-sm text-slate-500">* API 자동 갱신 : 1분 간격</p>
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.25)]" />
              <span className="text-slate-500">LIVE</span>
              <span className="tabular-nums text-slate-700">
                {lastUpdated ? lastUpdated.toLocaleString("ko-KR", { hour12: false }) : "—"}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            title="이용 안내"
            aria-label="이용 안내 열기"
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-bold text-slate-500 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e40af]/60"
          >
            ?
          </button>
        </div>

        <DashboardControlStack
          displayMode={displayMode}
          onDisplayModeChange={setDisplayMode}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          selectedDate={selectedDate}
          onSelectedDateChange={setSelectedDate}
          availableDates={availableDates}
          keyword={keyword}
          onKeywordChange={setKeyword}
          searchRows={searchRows}
          navigateFlashKey={navigateFlashKey}
          kePinkHighlight={kePinkHighlight}
          onSearchRowNavigate={handleSearchRowClick}
          isMainlineKeFlight={isMainlineKeFlight}
          visibleSlots={visibleSlots}
        />

        <div className="space-y-1" role="region" aria-label="데이터 상태">
          <div aria-live="polite" aria-atomic="true">
            {loading && (
              <p className="text-left text-sm font-medium text-[#1e40af]">데이터를 불러오는 중...</p>
            )}
          </div>
          <div aria-live="assertive" aria-atomic="true" className="space-y-1">
            {error && <p className="text-left text-sm font-medium text-red-600">오류: {error}</p>}
            {refreshError && (
              <p className="text-left text-sm font-medium text-amber-800">
                갱신 실패(이전 데이터 표시): {refreshError}
              </p>
            )}
          </div>
        </div>
      </header>

      {displayMode === "cards" ? (
        <div
          className="overflow-visible rounded-xl border border-slate-200 bg-white shadow-sm"
          style={{ ["--list-toolbar-h" as string]: LIST_STICKY_TOOLBAR_HEIGHT } as CSSProperties}
        >
          {visibleSlots.length > 0 ? (
            <div
              className={`sticky top-0 ${Z_LIST_TOOLBAR} flex min-h-[var(--list-toolbar-h)] items-center justify-end border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur-sm sm:px-4`}
            >
              <button
                type="button"
                aria-pressed={listProcessingHoverPopover}
                title={
                  listProcessingHoverPopover
                    ? "항공편에 마우스를 올렸을 때 뜨는 수하물 처리 시간 창을 끕니다."
                    : "수하물 처리 시간 작은 창을 다시 표시합니다."
                }
                onClick={() => {
                  setListProcessingHoverPopover((prev) => {
                    const next = !prev;
                    if (!next) {
                      cancelProcessingPopoverLeaveTimer();
                      setProcessingPopoverSlotKey(null);
                      setListProcessingSheetSlotKey(null);
                    }
                    return next;
                  });
                }}
                className={`rounded-md border px-2.5 py-1.5 text-[10px] font-semibold leading-tight shadow-sm sm:px-3 sm:text-[11px] ${
                  listProcessingHoverPopover
                    ? "border-slate-800 bg-slate-800 text-white"
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                처리 시간
              </button>
            </div>
          ) : null}
          <div className="p-3 sm:p-4">
            {visibleSlots.length === 0 ? (
              <EmptyState message="현재 운항 정보가 없습니다. 필터나 날짜를 확인해 주세요." />
            ) : (
              <div className="space-y-6 overflow-visible">
              {hours.map((hour) => {
                const items = cardSlotsByHour.get(hour);
                if (!items?.length && !LIST_VIEW_ALWAYS_SHOW_HOURS.has(hour)) return null;
                return (
                  <section key={hour} data-hour-section={hour} className="overflow-visible pb-1">
                    <h2 className="sticky top-[var(--list-toolbar-h)] z-10 mb-2 border-b border-slate-200 bg-white/95 pb-1 text-base font-bold tabular-nums tracking-tight text-slate-950 backdrop-blur-sm sm:text-lg">
                      {hour}
                    </h2>
                    {!items?.length ? (
                      <p className="text-sm text-slate-500">이 시간대에 표시할 항공편이 없습니다.</p>
                    ) : (
                    <ul className="grid gap-2 overflow-visible sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((item) => {
                        const slotKey = getSlotDedupeKey(item);
                        const highlighted = highlightKeys.has(slotKey);
                        const popoverOpen =
                          listProcessingHoverPopover && processingPopoverSlotKey === slotKey;
                        return (
                          <li key={slotKey} className="overflow-visible">
                            <article
                              data-baggage-slot={slotKey}
                              data-clicked={highlighted ? "true" : undefined}
                              data-clicked-ke={
                                highlighted && kePinkHighlight && isMainlineKeFlight(item.flight)
                                  ? "true"
                                  : undefined
                              }
                              className={`relative flex items-center gap-1.5 overflow-visible rounded-lg border p-3 text-xs leading-relaxed text-slate-800 transition-[box-shadow,background-color] duration-200 ${popoverOpen ? Z_LIST_CARD_POPOVER_ACTIVE : Z_LIST_CARD_BASE} ${slotShellClass(
                                highlighted,
                                item.flight,
                                kePinkHighlight,
                                isBagLastTimePassed(item, nowMs)
                              )} ${navigateFlashKey === slotKey ? navigateFlashShellClass : ""}`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                  <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-900">
                                    적재대 {item.carousel}번
                                  </span>
                                  <span className="text-[10px] text-slate-500">
                                    터미널 {getTerminal(item.raw) || "—"}
                                  </span>
                                </div>
                                <div
                                  className="relative min-w-0"
                                  onMouseEnter={
                                    prefersNoHover
                                      ? undefined
                                      : () => openProcessingPopover(slotKey)
                                  }
                                  onMouseLeave={prefersNoHover ? undefined : scheduleCloseProcessingPopover}
                                >
                                  <SlotDetail
                                    item={item}
                                    flightLineClassName={
                                      listProcessingHoverPopover && !prefersNoHover
                                        ? "cursor-help"
                                        : undefined
                                    }
                                  />
                                  {popoverOpen ? (
                                    <div
                                      className={`absolute bottom-full left-1/2 ${Z_LIST_HOVER_POPOVER} mb-2 w-max min-w-[14rem] max-w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xl ring-1 ring-slate-900/10 ${
                                        slotKey === firstListCardSlotKey
                                          ? "translate-y-2 sm:translate-y-3"
                                          : ""
                                      }`}
                                      onMouseEnter={cancelProcessingPopoverLeaveTimer}
                                      onMouseLeave={scheduleCloseProcessingPopover}
                                      role="tooltip"
                                      aria-live="polite"
                                    >
                                      <p className="mb-2 border-b border-slate-100 pb-1.5 text-[11px] font-bold text-slate-900">
                                        수하물 처리 시간
                                      </p>
                                      <div className="text-xs leading-relaxed text-slate-800">
                                        <ProcessingSlotDetail item={item} />
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-col items-center gap-1 self-stretch sm:self-start">
                                {prefersNoHover && listProcessingHoverPopover ? (
                                  <button
                                    type="button"
                                    className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md border border-slate-300 bg-white text-sm font-bold text-slate-600 hover:bg-slate-50 active:bg-slate-100"
                                    aria-label="수하물 처리 시간 보기"
                                    title={
                                      hasBaggageProcessingTimes(item)
                                        ? "수하물 처리 시간"
                                        : "처리 시간 데이터 없음"
                                    }
                                    onClick={() => setListProcessingSheetSlotKey(slotKey)}
                                  >
                                    ⓘ
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => toggleHighlightKey(slotKey)}
                                  className={`self-center ${highlightMarkButtonClassList}`}
                                  aria-pressed={highlighted}
                                  aria-label={highlighted ? "강조 해제" : "강조 표시"}
                                  title={highlighted ? "강조 해제" : "강조 표시"}
                                >
                                  {highlighted ? "★" : "☆"}
                                </button>
                              </div>
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
        </div>
      ) : displayMode === "processing" ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {visibleSlots.length === 0 ? (
            <div className="p-3 sm:p-4">
              <EmptyState message="현재 운항 정보가 없습니다. 필터나 날짜를 확인해 주세요." />
            </div>
          ) : (
            <>
              {isMobileGridViewport ? (
                <p className="border-b border-slate-200 bg-white px-3 py-2 text-[10px] leading-snug text-slate-500">
                  격자는 두 손가락으로 벌리거나 모아 확대·축소할 수 있어요.
                </p>
              ) : null}
              <div
                className={
                  gridNeedsHorizontalScroll
                    ? "table-scroll w-full min-w-0 overflow-x-auto overflow-y-hidden"
                    : "w-full min-w-0"
                }
              >
                <div
                  ref={tablePinchWrapRef}
                  className="origin-top-left align-top w-full max-w-full min-w-0 [text-size-adjust:100%] [-webkit-text-size-adjust:100%]"
                  style={gridScaleStyle}
                >
                  <CarouselDataGrid
                    hours={hours}
                    byHourCarousel={byHourCarousel}
                    carouselGuideVisible={carouselGuideVisible}
                    onToggleGuide={toggleCarouselGuide}
                    highlightKeys={highlightKeys}
                    navigateFlashKey={navigateFlashKey}
                    kePinkHighlight={kePinkHighlight}
                    toggleHighlightKey={toggleHighlightKey}
                    variant="processing"
                    renderCellContent={(item) => <ProcessingSlotDetail item={item} compact />}
                    slotShellClassFn={slotShellClass}
                    navigateFlashShellClass={navigateFlashShellClass}
                    nowMs={nowMs}
                    stickyHeader={!isMobileGridViewport && Math.abs(mobileGridZoom - 1) < 0.0001}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          {isMobileGridViewport ? (
            <p className="border-b border-slate-200 bg-white px-3 py-2 text-[10px] leading-snug text-slate-500">
              격자는 두 손가락으로 벌리거나 모아 확대·축소할 수 있어요.
            </p>
          ) : null}
          <div
            className={
              gridNeedsHorizontalScroll
                ? "table-scroll w-full min-w-0 overflow-x-auto overflow-y-hidden"
                : "w-full min-w-0"
            }
          >
            <div
              ref={tablePinchWrapRef}
              className="origin-top-left align-top w-full max-w-full min-w-0 [text-size-adjust:100%] [-webkit-text-size-adjust:100%]"
              style={gridScaleStyle}
            >
              <CarouselDataGrid
                hours={hours}
                byHourCarousel={byHourCarousel}
                carouselGuideVisible={carouselGuideVisible}
                onToggleGuide={toggleCarouselGuide}
                highlightKeys={highlightKeys}
                navigateFlashKey={navigateFlashKey}
                kePinkHighlight={kePinkHighlight}
                toggleHighlightKey={toggleHighlightKey}
                variant="schedule"
                renderCellContent={(item) => <SlotDetail item={item} compact />}
                slotShellClassFn={slotShellClass}
                navigateFlashShellClass={navigateFlashShellClass}
                nowMs={nowMs}
                stickyHeader={!isMobileGridViewport && Math.abs(mobileGridZoom - 1) < 0.0001}
              />
            </div>
          </div>
        </div>
      )}

      {listSheetSlotItem && displayMode === "cards" ? (
        <div
          className={`fixed inset-0 ${Z_SHEET_BACKDROP} flex items-end justify-center bg-slate-900/45 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-10 sm:items-center sm:p-4`}
          role="presentation"
          onClick={() => setListProcessingSheetSlotKey(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="list-processing-sheet-title"
            className={`${Z_SHEET_PANEL} relative max-h-[min(85vh,32rem)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:rounded-2xl`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <p id="list-processing-sheet-title" className="text-base font-bold text-slate-900">
                수하물 처리 시간
              </p>
              <button
                type="button"
                className="shrink-0 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => setListProcessingSheetSlotKey(null)}
              >
                닫기
              </button>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              {formatFlightAirportLine(listSheetSlotItem)} · 적재대 {listSheetSlotItem.carousel}번
            </p>
            {listSheetSlotItem.note === "fixedSchedule" && !hasBaggageProcessingTimes(listSheetSlotItem) ? (
              <p className="text-sm leading-relaxed text-slate-600">
                고정 스케줄(막바지 시간대) 행은 공공데이터에 첫·마지막 수하물 시각이 없습니다.
              </p>
            ) : (
              <div className="text-sm leading-relaxed">
                <ProcessingSlotDetail item={listSheetSlotItem} abbrevLegend />
              </div>
            )}
          </div>
        </div>
      ) : null}
      <p className="pt-1 text-center text-[10px] text-slate-400 sm:text-xs">
        인천국제공항공사 공공데이터 | 본 서비스는 비공식 개인 프로젝트이며, 제공되는 정보는 실제
        공항 상황과 차이가 있을 수 있으므로 참고용으로만 활용해 주시기 바랍니다.
      </p>
      <DashboardHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </section>
    </>
  );
}
