/**
 * Monthly cumulative timer — a small HUD parked just above the composer.
 *
 * Rendered through the `shell.overlay` slot: the overlay itself is click-through,
 * so the card re-enables pointer events for its own box only.
 */
declare const React: any;

import { BANNER_BG, BANNER_HEIGHT, BANNER_WIDTH } from "./asset";
import {
  BACKDROPS,
  MIN_MS,
  MAX_WIDTH,
  MIN_WIDTH,
  NODE_MODES,
  PLACEMENTS,
  addStage,
  clamp,
  deleteStage,
  DEFAULT_WIDTH,
  STORE_KEY,
  fmtClock,
  fmtDate,
  fmtHM,
  fmtNode,
  fmtPercent,
  isCurrentMonth,
  loadStore,
  monthLabel,
  monthOptions,
  monthRecord,
  refreshMonth,
  saveStore,
  selectMonth,
  setBackdrop,
  setPlacement,
  serialize,
  setNodeMode,
  toggleCollapsed,
  workdaysInMonth,
  type Stage,
  type Store,
} from "./store";
import { createTranslator, getLang } from "./i18n";
import { applySeed } from "./seed";

const { useState, useEffect, useRef, useMemo } = React;

const RATIO = BANNER_HEIGHT / BANNER_WIDTH;
const FONT =
  'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif';
const NS_ID = "month-timer";
const NS_ANCHOR = "month-timer-anchor";

let t: (key: string, vars?: Record<string, any>) => string = (key) => key;
let lang = "zh";

/* ------------------------------------------------------------------ anchor */

/**
 * The widget lives in the frame-wide overlay, but it should sit over the
 * conversation column rather than the window centre — and just above the
 * composer card. A zero-size probe in the composer dock measures the nearest
 * bottom-docked box (the composer card) and publishes its centre, width and top;
 * the widget follows it and falls back to the viewport centre when the probe
 * never mounts.
 */
const anchor = { ready: false, center: 0, width: 0, composerTop: 0 };
const anchorSubs = new Set<() => void>();

function publishAnchor(center: number, width: number, composerTop: number): void {
  if (!Number.isFinite(center) || !Number.isFinite(width) || width < 40) return;
  anchor.ready = true;
  anchor.center = center;
  anchor.width = width;
  anchor.composerTop = Number.isFinite(composerTop) ? composerTop : 0;
  anchorSubs.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      /* a stale subscriber must not break the others */
    }
  });
}

function AnchorProbe() {
  const ref = useRef<any>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const boxes: any[] = [];
      let host = node.parentElement;
      for (let depth = 0; host && depth < 8; depth += 1) {
        const rect = host.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) boxes.push(rect);
        host = host.parentElement;
      }
      if (!boxes.length) return;

      // The composer card: a bottom-docked box that is wide but never as wide as
      // the page (the dock itself is a thin strip, the page shell is huge).
      const docked = boxes.filter(
        (r: any) =>
          r.width >= 260 &&
          r.width <= vw - 80 &&
          r.height >= 40 &&
          r.bottom >= vh - 260 &&
          r.top >= vh * 0.45
      );
      let target = docked.length
        ? docked.reduce((best: any, r: any) => (r.width > best.width ? r : best), docked[0])
        : null;
      if (!target) {
        const wide = boxes.filter((r: any) => r.width >= 260 && r.width <= vw - 60);
        target = wide.length ? wide[0] : boxes[0];
      }
      publishAnchor(target.left + target.width / 2, target.width, target.top);
    };

    measure();
    window.addEventListener("resize", measure);
    let observer: any = null;
    if (typeof ResizeObserver !== "undefined" && node.parentElement) {
      observer = new ResizeObserver(measure);
      observer.observe(node.parentElement);
    }
    const timer = window.setInterval(measure, 1200);
    return () => {
      window.removeEventListener("resize", measure);
      window.clearInterval(timer);
      if (observer) observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, pointerEvents: "none" }}
    />
  );
}

/* ------------------------------------------------------------------- icons */

function IconSliders(props: any) {
  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2.4 4.6h11.2M2.4 11.4h11.2" />
      <circle cx="6.1" cy="4.6" r="1.6" fill="#FFFFFF" />
      <circle cx="10.2" cy="11.4" r="1.6" fill="#FFFFFF" />
    </svg>
  );
}

function IconChevron(props: any) {
  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={props.style}
    >
      <path d={props.up ? "M3.6 10.2 L8 5.8 L12.4 10.2" : "M3.6 5.8 L8 10.2 L12.4 5.8"} />
    </svg>
  );
}

function IconPlus(props: any) {
  return (
    <svg width={props.size} height={props.size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3.2 L8 12.8" />
      <path d="M3.2 8 L12.8 8" />
    </svg>
  );
}

/* --------------------------------------------------------------- component */

const CSS = `
.dmt-month, .dmt-mode { transition: background .15s ease, border-color .15s ease; }
.dmt-month:hover, .dmt-mode:hover { background: linear-gradient(180deg,#ffffff,#E9F0FF) !important; border-color:#AFC2EE !important; }
.dmt-month:active, .dmt-mode:active { transform: translateY(1px); }
.dmt-month:focus-visible, .dmt-mode:focus-visible, .dmt-add:focus-visible, .dmt-icon:focus-visible, .dmt-seg:focus-visible {
  outline: 2px solid #7E97E8; outline-offset: 2px;
}
.dmt-icon { transition: background .15s ease, color .15s ease, transform .1s ease; }
.dmt-icon:hover { background:#E9F1FF !important; border-color:#AFC2EE !important; color:#3A4FA8 !important; }
.dmt-icon:active { transform: scale(.93); }
.dmt-add { transition: filter .15s ease, transform .12s ease; }
.dmt-add:hover { filter: brightness(1.07); transform: translateY(-1px) scale(1.04); }
.dmt-add:active { transform: scale(.95); }
.dmt-input::placeholder { color:#9AA5CC; }
.dmt-input:focus { border-color:#7E97E8 !important; background:#ffffff !important; box-shadow:0 0 0 3px rgba(110,134,224,.18) !important; }
.dmt-seg { transition: filter .12s ease; }
.dmt-seg:hover { filter: brightness(1.07) saturate(1.04); }
@keyframes dmt-stripes { from { background-position: 0 0; } to { background-position: 22px 0; } }
/* fade only: a transform in the keyframes would override the inline
   translateX(-50%) / translateY() used for positioning. */
@keyframes dmt-pop { from { opacity:0; } to { opacity:1; } }
.dmt-pop { animation: dmt-pop .14s ease-out both; }
.dmt-pickerItem { transition: background .12s ease; }
.dmt-pickerItem:hover { background:#EFF4FF; }
.dmt-menuItem { transition: background .12s ease; }
.dmt-menuItem:hover { background:#FFF1F1; }
.dmt-picker::-webkit-scrollbar { width:6px; }
.dmt-picker::-webkit-scrollbar-thumb { background:#C7D4F2; border-radius:3px; }
.dmt-picker::-webkit-scrollbar-track { background:transparent; }
.dmt-grip { opacity:0; transition: opacity .16s ease; cursor:ew-resize; touch-action:none; }
.dmt-card:hover .dmt-grip { opacity:.9; }
`;

function MonthTimerWidget() {
  const [state, setState] = useState<Store>(() => loadStore());
  const stRef = useRef(state);
  stRef.current = state;

  const [vw, setVw] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1440));
  const [vh, setVh] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 900));
  const [, bumpAnchor] = useState(0);
  const [late, setLate] = useState(false);
  const [hover, setHover] = useState<any>(null);
  const [menu, setMenu] = useState<any>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [lookOpen, setLookOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [note, setNote] = useState("");
  const [mins, setMins] = useState("");
  const [secs, setSecs] = useState("");
  const [dragging, setDragging] = useState(false);

  const menuRef = useRef<any>(null);
  const monthRef = useRef<any>(null);
  const modeRef = useRef<any>(null);
  const lookRef = useRef<any>(null);
  const pickerBodyRef = useRef<any>(null);
  const selectedRef = useRef<any>(null);
  const gripRef = useRef<any>(null);
  const hintTimer = useRef<any>(null);
  const dragRef = useRef<any>(null);
  const lastSaved = useRef<string | null>(null);

  /* no stopwatch any more: a slow refresh only rolls the view over at midnight */
  useEffect(() => {
    const id = setInterval(() => setState((s) => refreshMonth(s, Date.now())), 30000);
    return () => clearInterval(id);
  }, []);

  /* persistence: debounced write, plus a flush when the page goes away */
  useEffect(() => {
    const payload = serialize(state);
    if (payload === lastSaved.current) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, payload);
        lastSaved.current = payload;
      } catch (e) {
        /* ignore quota / privacy-mode failures */
      }
    }, 700);
    return () => clearTimeout(id);
  }, [state]);

  useEffect(() => {
    const flush = () => saveStore(stRef.current);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const follow = () => bumpAnchor((n) => n + 1);
    anchorSubs.add(follow);
    follow();
    return () => {
      anchorSubs.delete(follow);
    };
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setLate(true), 700);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => () => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
  }, []);

  /* dismiss menus */
  useEffect(() => {
    if (menu) {
      const onDown = (event: any) => {
        const el = menuRef.current;
        if (el && (el === event.target || el.contains(event.target))) return;
        setMenu(null);
      };
      window.addEventListener("pointerdown", onDown, true);
      return () => window.removeEventListener("pointerdown", onDown, true);
    }
    return undefined;
  }, [menu]);

  useEffect(() => {
    if (pickerOpen) {
      const onDown = (event: any) => {
        const el = monthRef.current;
        if (el && (el === event.target || el.contains(event.target))) return;
        setPickerOpen(false);
      };
      window.addEventListener("pointerdown", onDown, true);
      return () => window.removeEventListener("pointerdown", onDown, true);
    }
    return undefined;
  }, [pickerOpen]);

  useEffect(() => {
    if (modeOpen) {
      const onDown = (event: any) => {
        const el = modeRef.current;
        if (el && (el === event.target || el.contains(event.target))) return;
        setModeOpen(false);
      };
      window.addEventListener("pointerdown", onDown, true);
      return () => window.removeEventListener("pointerdown", onDown, true);
    }
    return undefined;
  }, [modeOpen]);

  useEffect(() => {
    if (lookOpen) {
      const onDown = (event: any) => {
        const el = lookRef.current;
        if (el && (el === event.target || el.contains(event.target))) return;
        setLookOpen(false);
      };
      window.addEventListener("pointerdown", onDown, true);
      return () => window.removeEventListener("pointerdown", onDown, true);
    }
    return undefined;
  }, [lookOpen]);

  useEffect(() => {
    if (!menu && !pickerOpen && !modeOpen && !lookOpen) return undefined;
    const onKey = (event: any) => {
      if (event.key === "Escape") {
        setMenu(null);
        setPickerOpen(false);
        setModeOpen(false);
        setLookOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, pickerOpen, modeOpen, lookOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const body = pickerBodyRef.current;
    const item = selectedRef.current;
    if (body && item) body.scrollTop = Math.max(0, item.offsetTop - body.clientHeight / 2 + item.offsetHeight / 2);
  }, [pickerOpen]);

  const rec = monthRecord(state, state.month);
  const workdays = workdaysInMonth(state.month);
  const nodeMinutes = workdays * state.nodeMode;
  const nodeMs = nodeMinutes * MIN_MS;
  const maxMs = nodeMs * 2;
  const committedMs = rec.stages.reduce((sum: number, s: Stage) => sum + s.ms, 0);
  const totalMs = committedMs;
  const frac = clamp(totalMs / maxMs, 0, 1);
  const nodeFrac = Math.max(0, totalMs / nodeMs);
  const done = totalMs >= nodeMs;
  const viewing = !isCurrentMonth(state.month);
  const options = useMemo(() => monthOptions(state), [state.month, state.months]);

  const maxW = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, vw - 28));
  // No explicit width yet: hug the conversation column so the banner lines up
  // with the chat instead of spilling over the sidebar.
  const autoWidth = anchor.ready && anchor.width > 0 ? anchor.width : DEFAULT_WIDTH;
  const width = Math.round(clamp(state.width > 0 ? state.width : autoWidth, MIN_WIDTH, maxW));
  const height = Math.round(width * RATIO);
  const center = anchor.ready ? anchor.center : vw / 2;
  const left = Math.round(center - width / 2);
  const shown = anchor.ready || late;
  // Sit directly above the composer card, never off-screen.
  const composerTop = anchor.ready && anchor.composerTop > 0 ? anchor.composerTop : vh - 96;
  const bottom = Math.max(8, Math.round(vh - composerTop + 8));

  const k = Math.max(0.85, width / 960);
  const px = (n: number) => Math.round(n * k * 100) / 100;

  // Placement + backdrop: the art has a transparent background now, so the card
  // itself decides how much of the page shows through.
  const placedTop = state.position === "top";
  const panelFill =
    state.bg === "paper" ? "#FFFFFF" : state.bg === "glass" ? "rgba(255,255,255,.40)" : "transparent";
  const panelBlur = state.bg === "glass" ? "blur(18px) saturate(1.12)" : "none";
  const panelBorder =
    state.bg === "glass" ? "1px solid rgba(255,255,255,.60)" : "1px solid transparent";
  const panelShadow =
    state.bg === "paper"
      ? "0 12px 30px rgba(52,66,140,.18), 0 2px 8px rgba(52,66,140,.10)"
      : state.bg === "glass"
      ? "0 10px 26px rgba(52,66,140,.16)"
      : "none";
  const cardTextShadow = state.bg === "clear" ? "0 0 7px rgba(255,255,255,.9)" : "none";

  const committedFrac = clamp(committedMs / maxMs, 0, 1);

  function flash(text: string) {
    setHint(text);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(""), 2400);
  }

  function onAdd() {
    const minutes = Number(String(mins).replace(/[^\d.]/g, "")) || 0;
    const seconds = Math.min(59, Number(String(secs).replace(/[^\d.]/g, "")) || 0);
    const ms = Math.round(minutes * MIN_MS + seconds * 1000);
    if (!Number.isFinite(ms) || ms <= 0) {
      flash(t("hintNeedMinutes"));
      return;
    }
    const result = addStage(stRef.current, ms, note);
    if (!result.ok) {
      flash(t("hintNeedMinutes"));
      return;
    }
    setState(result.state);
    setNote("");
    setMins("");
    setSecs("");
    if (!note.trim()) flash(t("hintNoNote"));
  }

  function onGripDown(event: any) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (e) {
      /* pointer capture is best-effort */
    }
    dragRef.current = { x: event.clientX, w: width };
    setDragging(true);
  }

  function onGripMove(event: any) {
    const start = dragRef.current;
    if (!start) return;
    const next = Math.round(clamp(start.w + (event.clientX - start.x) * 2, MIN_WIDTH, maxW));
    setState((s) => (s.width === next ? s : { ...s, width: next }));
  }

  function onGripUp(event: any) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch (e) {
      /* ignore */
    }
  }

  /* ------------------------------------------------------------ collapsed */

  if (state.collapsed) {
    const stripHeight = px(46);
    return (
      <div
        style={{
          position: "fixed",
          ...(placedTop ? { top: 8 } : { bottom }),
          left,
          width,
          height: stripHeight,
          zIndex: 30,
          pointerEvents: "none",
          visibility: shown ? "visible" : "hidden",
          fontFamily: FONT,
          WebkitAppRegion: "no-drag",
        }}
      >
        <div
          style={{
            pointerEvents: "auto",
            width: "100%",
            height: "100%",
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: px(10),
            padding: `0 ${px(14)}px`,
            borderRadius: stripHeight / 2,
            background:
              state.bg === "paper" ? "linear-gradient(180deg,#FFFFFF 0%,#EAF0FF 100%)" : "rgba(255,255,255,.52)",
            backdropFilter: state.bg === "clear" ? "blur(10px)" : "blur(16px) saturate(1.12)",
            WebkitBackdropFilter: state.bg === "clear" ? "blur(10px)" : "blur(16px) saturate(1.12)",
            border: "1.5px solid rgba(185,203,240,.85)",
            boxShadow: "0 6px 18px rgba(52,66,140,.18), 0 1px 3px rgba(52,66,140,.10)",
            color: "#33417F",
            userSelect: "none",
          }}
        >
          <span style={{ fontSize: px(12.5), fontWeight: 700, whiteSpace: "nowrap" }}>
            {monthLabel(state.month, lang)}
          </span>
          <span
            style={{
              fontSize: px(15),
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              color: "#2F3B7A",
            }}
          >
            {fmtClock(totalMs)}
          </span>
          <span
            style={{
              fontSize: px(10.5),
              fontWeight: 600,
              whiteSpace: "nowrap",
              color: done ? "#2E7D46" : "#8A6320",
            }}
          >
            {done ? "✅️ " + t("done") : "⭕️ " + t("notDone")}
          </span>
          <div
            style={{
              position: "relative",
              flex: "1 1 auto",
              minWidth: px(40),
              height: px(8),
              borderRadius: px(4),
              background: "#D9E2F7",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: frac * 100 + "%",
                borderRadius: px(4),
                background: done
                  ? "linear-gradient(90deg,#6FC98A,#3FAE6A)"
                  : "linear-gradient(90deg,#8FA9EE,#5B6FE0)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 0,
                bottom: 0,
                width: 2,
                marginLeft: -1,
                background: "#3E4FA8",
              }}
            />
          </div>
          <span style={{ fontSize: px(10.5), color: "#7C88B8", whiteSpace: "nowrap", minWidth: px(34), textAlign: "right" }}>
            {fmtPercent(nodeFrac)}
          </span>
          <button
            className="dmt-icon"
            type="button"
            title={t("expand")}
            aria-label={t("expand")}
            onClick={() => setState((s) => toggleCollapsed(s))}
            style={iconButton(px(24), px)}
          >
            <IconChevron size={px(12)} up={false} />
          </button>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------- expanded */

  const tipX = hover ? Math.max(2, Math.min(98, hover.x * 100)) : 50;
  // Left-anchored near the start of the bar, right-anchored near the end, so the
  // tooltip never hangs outside the card.
  const tipShift = tipX < 42 ? "none" : tipX > 58 ? "translateX(-100%)" : "translateX(-50%)";
  const hoverStage: Stage | null =
    hover && hover.kind === "stage" ? rec.stages.filter((s) => s.id === hover.id)[0] ?? null : null;

  return (
    <div
      style={{
        position: "fixed",
        ...(placedTop ? { top: 8 } : { bottom }),
        left,
        width,
        height,
        zIndex: 30,
        pointerEvents: "none",
        visibility: shown ? "visible" : "hidden",
        fontFamily: FONT,
        WebkitAppRegion: "no-drag",
        transition: dragging ? "none" : "width .12s ease",
      }}
    >
      <div
        className="dmt-card"
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          backgroundImage: `url("${BANNER_BG}")`,
          backgroundSize: "100% 100%",
          backgroundRepeat: "no-repeat",
          backgroundColor: panelFill,
          backdropFilter: panelBlur,
          WebkitBackdropFilter: panelBlur,
          border: panelBorder,
          borderRadius: px(16),
          boxShadow: panelShadow,
          textShadow: cardTextShadow,
          pointerEvents: "auto",
          boxSizing: "border-box",
          color: "#33417F",
          userSelect: "none",
        }}
      >
        {/* header: month, workdays, status, controls */}
        <div
          style={{
            position: "absolute",
            left: "23.2%",
            right: "3.4%",
            top: "5%",
            height: "48.5%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: px(9), minHeight: px(30) }}>
            <div ref={monthRef} style={{ position: "relative" }}>
              <button
                className="dmt-month"
                type="button"
                title={t("pickMonth")}
                onClick={() => setPickerOpen((open) => !open)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: px(6),
                  height: px(28),
                  padding: `0 ${px(11)}px`,
                  border: "1px solid #C7D4F2",
                  borderRadius: px(14),
                  background: "linear-gradient(180deg,#FFFFFF,#F2F6FF)",
                  color: "#33417F",
                  fontFamily: FONT,
                  fontSize: px(13),
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <span>{monthLabel(state.month, lang)}</span>
                <IconChevron size={px(11)} up={pickerOpen} style={{ opacity: 0.7 }} />
              </button>

              {pickerOpen ? (
                <div
                  className="dmt-pop"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: `calc(100% + ${px(6)}px)`,
                    width: px(196),
                    background: "#FFFFFF",
                    border: "1px solid #C7D4F2",
                    borderRadius: px(12),
                    boxShadow: "0 14px 28px rgba(52,66,140,.20)",
                    zIndex: 40,
                    overflow: "hidden",
                  }}
                >
                  <div
                    ref={pickerBodyRef}
                    className="dmt-picker"
                    style={{ maxHeight: px(236), overflowY: "auto", overflowX: "hidden", padding: `${px(4)}px` }}
                  >
                    {options.map((option) => {
                      const active = option.key === state.month;
                      return (
                        <div
                          key={option.key}
                          ref={active ? selectedRef : null}
                          className="dmt-pickerItem"
                          onClick={() => {
                            setState((s) => selectMonth(s, option.key));
                            setPickerOpen(false);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: px(8),
                            padding: `${px(6)}px ${px(9)}px`,
                            borderRadius: px(8),
                            cursor: "pointer",
                            background: active ? "#E8EFFF" : "transparent",
                            color: active ? "#2F3B7A" : "#4A5588",
                            fontSize: px(12),
                            fontWeight: active ? 700 : 500,
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span>{monthLabel(option.key, lang)}</span>
                          <span style={{ fontSize: px(10), color: "#6E7AAB" }}>
                            {t("daysShort", { n: option.workdays })} · {fmtNode(option.workdays * state.nodeMode)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            <div ref={modeRef} style={{ position: "relative" }}>
              <button
                className="dmt-mode"
                type="button"
                title={t("modeTitle")}
                aria-label={t("modeTitle")}
                aria-haspopup="listbox"
                aria-expanded={modeOpen}
                onClick={() => setModeOpen((open) => !open)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: px(4),
                  height: px(28),
                  padding: `0 ${px(8)}px`,
                  border: "1px solid #C7D4F2",
                  borderRadius: px(14),
                  background: "linear-gradient(180deg,#FFFFFF,#F2F6FF)",
                  color: "#33417F",
                  fontFamily: FONT,
                  fontSize: px(12),
                  fontWeight: 700,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <span>{"工作日 ×" + state.nodeMode}</span>
                <IconChevron size={px(10)} up={modeOpen} style={{ opacity: 0.7 }} />
              </button>

              {modeOpen ? (
                <div
                  className="dmt-pop"
                  role="listbox"
                  aria-label={t("modeTitle")}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: `calc(100% + ${px(6)}px)`,
                    width: px(160),
                    padding: `${px(4)}px`,
                    background: "#FFFFFF",
                    border: "1px solid #C7D4F2",
                    borderRadius: px(12),
                    boxShadow: "0 14px 28px rgba(52,66,140,.20)",
                    zIndex: 40,
                  }}
                >
                  {NODE_MODES.map((mode) => {
                    const active = mode === state.nodeMode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        role="option"
                        aria-selected={active}
                        className="dmt-pickerItem"
                        onClick={() => {
                          setState((s) => setNodeMode(s, mode));
                          setModeOpen(false);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: px(8),
                          width: "100%",
                          padding: `${px(6)}px ${px(9)}px`,
                          border: "none",
                          borderRadius: px(8),
                          cursor: "pointer",
                          background: active ? "#E8EFFF" : "transparent",
                          color: active ? "#2F3B7A" : "#4A5588",
                          fontFamily: FONT,
                          fontSize: px(12),
                          fontWeight: active ? 700 : 500,
                          whiteSpace: "nowrap",
                          textAlign: "left",
                        }}
                      >
                        <span>{"×" + mode}</span>
                        <span style={{ fontSize: px(10.5), color: "#5F6B9E" }}>
                          {fmtNode(workdays * mode)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <span style={{ fontSize: px(11.5), color: "#6E7AAB", whiteSpace: "nowrap" }}>
              {t("meta", { d: workdays, n: fmtNode(nodeMinutes) })}
            </span>

            {viewing ? (
              <span
                title={t("viewingTip")}
                style={{
                  fontSize: px(10.5),
                  fontWeight: 600,
                  color: "#6E7AAB",
                  background: "#EEF2FC",
                  border: "1px solid #D9E2F6",
                  borderRadius: px(999),
                  padding: `0 ${px(7)}px`,
                  whiteSpace: "nowrap",
                }}
              >
                {t("viewing")}
              </span>
            ) : null}

            <div style={{ flex: "1 1 auto" }} />

            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: px(4),
                padding: `${px(3)}px ${px(10)}px`,
                borderRadius: px(999),
                border: `1px solid ${done ? "#9FD8AA" : "#F0CE8E"}`,
                background: done ? "linear-gradient(180deg,#F1FBF2,#E1F5E4)" : "linear-gradient(180deg,#FFF9EC,#FFF1D8)",
                color: done ? "#2E7D46" : "#9A6B18",
                fontSize: px(11),
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {done ? "✅️ " + t("done") : "⭕️ " + t("notDone")}
            </span>

            <div ref={lookRef} style={{ position: "relative" }}>
              <button
                className="dmt-icon"
                type="button"
                title={t("appearance")}
                aria-label={t("appearance")}
                aria-haspopup="dialog"
                aria-expanded={lookOpen}
                onClick={() => setLookOpen((open) => !open)}
                style={iconButton(px(26), px)}
              >
                <IconSliders size={px(13)} />
              </button>

              {lookOpen ? (
                <div
                  className="dmt-pop"
                  role="dialog"
                  aria-label={t("appearance")}
                  style={{
                    position: "absolute",
                    right: 0,
                    top: `calc(100% + ${px(6)}px)`,
                    width: px(196),
                    padding: `${px(9)}px ${px(9)}px ${px(10)}px`,
                    background: "#FFFFFF",
                    border: "1px solid #C7D4F2",
                    borderRadius: px(12),
                    boxShadow: "0 14px 28px rgba(52,66,140,.20)",
                    zIndex: 40,
                    display: "flex",
                    flexDirection: "column",
                    gap: px(7),
                  }}
                >
                  <span style={{ fontSize: px(10.5), fontWeight: 700, color: "#6E7AAB" }}>
                    {t("background")}
                  </span>
                  <div style={{ display: "flex", gap: px(4) }}>
                    {BACKDROPS.map((mode: any) => {
                      const active = mode === state.bg;
                      return (
                        <button
                          key={mode}
                          type="button"
                          className="dmt-pickerItem"
                          aria-pressed={active}
                          onClick={() => setState((s) => setBackdrop(s, mode))}
                          style={{
                            flex: "1 1 0",
                            padding: `${px(5)}px 0`,
                            borderRadius: px(8),
                            border: active ? "1px solid #A9C0EE" : "1px solid transparent",
                            background: active ? "#E8EFFF" : "#F4F7FE",
                            color: active ? "#2F3B7A" : "#4A5588",
                            fontFamily: FONT,
                            fontSize: px(11.5),
                            fontWeight: active ? 700 : 500,
                            cursor: "pointer",
                          }}
                        >
                          {t("bg" + mode.charAt(0).toUpperCase() + mode.slice(1))}
                        </button>
                      );
                    })}
                  </div>
                  <span style={{ fontSize: px(10.5), fontWeight: 700, color: "#6E7AAB" }}>
                    {t("placement")}
                  </span>
                  <div style={{ display: "flex", gap: px(4) }}>
                    {PLACEMENTS.map((spot: any) => {
                      const active = spot === state.position;
                      return (
                        <button
                          key={spot}
                          type="button"
                          className="dmt-pickerItem"
                          aria-pressed={active}
                          onClick={() => setState((s) => setPlacement(s, spot))}
                          style={{
                            flex: "1 1 0",
                            padding: `${px(5)}px 0`,
                            borderRadius: px(8),
                            border: active ? "1px solid #A9C0EE" : "1px solid transparent",
                            background: active ? "#E8EFFF" : "#F4F7FE",
                            color: active ? "#2F3B7A" : "#4A5588",
                            fontFamily: FONT,
                            fontSize: px(11.5),
                            fontWeight: active ? 700 : 500,
                            cursor: "pointer",
                          }}
                        >
                          {t("place" + spot.charAt(0).toUpperCase() + spot.slice(1))}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            <button
              className="dmt-icon"
              type="button"
              title={t("collapse")}
              aria-label={t("collapse")}
              onClick={() => setState((s) => toggleCollapsed(s))}
              style={iconButton(px(26), px)}
            >
              <IconChevron size={px(12)} up={true} />
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: px(12) }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: px(7) }}>
                <span style={{ fontSize: px(10.5), color: "#6E7AAB", letterSpacing: px(0.4) }}>
                  {t("thisMonth")}
                </span>
                <span
                  style={{
                    fontSize: px(9),
                    fontWeight: 600,
                    color: "#5F6B9E",
                    border: "1px solid #DCE3F5",
                    borderRadius: px(999),
                    padding: `0 ${px(5)}px`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {t("minuteSecond")}
                </span>
              </div>              <div
                style={{
                  fontSize: px(38),
                  lineHeight: 1.02,
                  fontWeight: 700,
                  letterSpacing: px(0.6),
                  color: "#2F3B7A",
                  fontVariantNumeric: "tabular-nums",
                  textShadow: "0 1px 0 rgba(255,255,255,.9)",
                }}
              >
                {fmtClock(totalMs)}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: px(16),
                paddingBottom: px(3),
                whiteSpace: "nowrap",
              }}
            >
              <Stat label={t("stages")} value={String(rec.stages.length)} px={px} />
              <Stat label={t("toNode")} value={done ? t("reached") : fmtHM(Math.max(0, nodeMs - totalMs))} px={px} />
              <Stat label={t("progress")} value={fmtPercent(nodeFrac)} px={px} />
            </div>
          </div>
        </div>

        {/* progress track, sitting inside the artwork's band */}
        <div
          style={{
            position: "absolute",
            left: "12.2%",
            top: "62.35%",
            width: "80.8%",
            height: "10.75%",
          }}
          onMouseLeave={() => setHover(null)}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: px(999),
              overflow: "hidden",
            }}
          >
            {/* the artwork's band is a saturated periwinkle; a light channel keeps
                the empty part readable and lets the stage colours pop */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(180deg, rgba(243,248,255,.88) 0%, rgba(230,239,254,.78) 46%, rgba(241,247,255,.84) 100%)",
                boxShadow:
                  "inset 0 1px 3px rgba(46,66,150,.20), inset 0 0 0 1px rgba(255,255,255,.40)",
                pointerEvents: "none",
              }}
            />

            {rec.stages.map((stage, index) => {
              const before = rec.stages.slice(0, index).reduce((sum, s) => sum + s.ms, 0);
              const x0 = before / maxMs;
              if (x0 >= 1) return null;
              const w = stage.ms / maxMs;
              return (
                <div
                  key={stage.id}
                  className="dmt-seg"
                  tabIndex={0}
                  role="button"
                  aria-label={stage.note || t("noteDefault")}
                  onFocus={() =>
                    setHover({ kind: "stage", id: stage.id, x: Math.min(1, x0 + w / 2) })
                  }
                  onBlur={() => setHover(null)}
                  onMouseEnter={() =>
                    setHover({ kind: "stage", id: stage.id, x: Math.min(1, x0 + w / 2) })
                  }
                  onKeyDown={(event: any) => {
                    if (event.key !== "Delete" && event.key !== "Backspace") return;
                    event.preventDefault();
                    setHover(null);
                    setState((s) => deleteStage(s, stage.id));
                  }}
                  onContextMenu={(event: any) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setHover(null);
                    setMenu({
                      x: Math.min(event.clientX + 4, vw - px(190)),
                      y: Math.min(event.clientY + 6, (typeof window !== "undefined" ? window.innerHeight : 800) - px(96)),
                      id: stage.id,
                      note: stage.note,
                      ms: stage.ms,
                    });
                  }}
                  style={{
                    position: "absolute",
                    left: x0 * 100 + "%",
                    width: w * 100 + "%",
                    top: 0,
                    bottom: 0,
                    minWidth: px(6),
                    background: `linear-gradient(180deg, rgba(255,255,255,.55) 0%, rgba(255,255,255,0) 52%, rgba(0,0,0,.10) 100%), ${stage.color}`,
                    boxShadow: "inset -1px 0 0 rgba(40,56,140,.20)",
                    cursor: "default",
                  }}
                />
              );
            })}

            {!rec.stages.length ? (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  // keep clear of the threshold node marker at 50%
                  paddingRight: "46%",
                  pointerEvents: "none",
                }}
              >
                <span
                  style={{
                    fontSize: px(10.5),
                    color: "rgba(52,68,140,.72)",
                    background: "rgba(255,255,255,.82)",
                    borderRadius: px(999),
                    padding: `${px(1)}px ${px(9)}px`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {viewing ? t("emptyHintView") : t("emptyHint")}
                </span>
              </div>
            ) : null}
          </div>

          {/* threshold node at 50% of the track */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "-2%",
              bottom: "-2%",
              width: Math.max(1.5, px(1.6)),
              transform: "translateX(-50%)",
              background: "rgba(52,66,150,.78)",
              borderRadius: px(2),
              boxShadow: "0 0 6px rgba(52,66,150,.35)",
              pointerEvents: "none",
            }}
          />
          <div
            onMouseEnter={() => setHover({ kind: "node", x: 0.5 })}
            style={{
              position: "absolute",
              left: "50%",
              // above the track, so it never covers the stage under the node
              bottom: `calc(100% + ${px(2)}px)`,
              transform: "translateX(-50%)",
              display: "flex",
              alignItems: "center",
              gap: px(3),
              height: "auto",
              padding: `${Math.max(1, px(1.5))}px ${px(6)}px`,
              borderRadius: px(999),
              background: done ? "linear-gradient(180deg,#F4FFF6,#DDF3E2)" : "linear-gradient(180deg,#FFFFFF,#EAF0FF)",
              border: `1px solid ${done ? "#8FD3A0" : "#9FB4E8"}`,
              boxShadow: "0 1px 4px rgba(40,56,140,.30)",
              color: done ? "#2E7D46" : "#3E4FA8",
              fontSize: px(9.5),
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              cursor: "default",
              zIndex: 2,
            }}
          >
            {done ? "✓ " : ""}
            {fmtNode(nodeMinutes)}
          </div>

          {hover ? (
            <div
              className="dmt-pop"
              style={{
                position: "absolute",
                left: tipX + "%",
                bottom: `calc(100% + ${px(9)}px)`,
                transform: tipShift,
                maxWidth: px(210),
                padding: `${px(6)}px ${px(9)}px`,
                borderRadius: px(9),
                background: "rgba(255,255,255,.95)",
                border: "1px solid #C7D4F2",
                boxShadow: "0 10px 24px rgba(52,66,140,.22)",
                backdropFilter: "blur(6px)",
                color: "#33417F",
                fontSize: px(11),
                lineHeight: 1.42,
                pointerEvents: "none",
                zIndex: 20,
                whiteSpace: "normal",
                wordBreak: "break-word",
              }}
            >
              {hover.kind === "node" ? (
                <div>
                  <div style={{ fontWeight: 700, marginBottom: px(2) }}>{t("nodeTipTitle")}</div>
                  <div style={{ color: "#5A6AA8" }}>
                    {t("nodeTipBody", { d: workdays, m: state.nodeMode, n: fmtNode(nodeMinutes) })}
                  </div>
                  <div style={{ color: "#9099C0", fontSize: px(10), marginTop: px(2) }}>{t("nodeTipMeta")}</div>
                </div>
              ) : hoverStage ? (
                <div>
                  <div style={{ fontWeight: 700, marginBottom: px(2) }}>{hoverStage.note || t("noteDefault")}</div>
                  <div style={{ color: "#5A6AA8" }}>
                    {t("duration")} {fmtHM(hoverStage.ms)}
                  </div>
                  <div style={{ color: "#9099C0", fontSize: px(10) }}>{fmtDate(hoverStage.at)}</div>
                  <div style={{ color: "#A9B2D2", fontSize: px(9.5), marginTop: px(2) }}>{t("rightClickDelete")}</div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* minutes + note + add */}
        <div
          style={{
            position: "absolute",
            left: "23.2%",
            right: "3.4%",
            top: "82.6%",
            height: "12.4%",
            display: "flex",
            alignItems: "center",
            gap: px(8),
          }}
        >
          <div
            style={{
              flex: "0 0 auto",
              display: "flex",
              alignItems: "center",
              gap: px(3),
              height: "100%",
              padding: `0 ${px(7)}px`,
              boxSizing: "border-box",
              borderRadius: px(999),
              border: "1.4px solid #C2D0F1",
              background: "#F8FAFF",
            }}
          >
            <input
              className="dmt-input dmt-mins"
              value={mins}
              onChange={(event: any) => setMins(event.target.value)}
              onKeyDown={(event: any) => {
                if (event.key === "Enter" && !event.nativeEvent?.isComposing) {
                  event.preventDefault();
                  onAdd();
                }
              }}
              placeholder={t("minutesPlaceholder")}
              aria-label={t("minutesPlaceholder")}
              inputMode="numeric"
              spellCheck={false}
              style={{
                width: px(30),
                height: "100%",
                padding: 0,
                border: "none",
                background: "transparent",
                color: "#2F3B7A",
                fontFamily: FONT,
                fontSize: px(12),
                fontWeight: 600,
                textAlign: "right",
                outline: "none",
              }}
            />
            <span style={{ fontSize: px(12), fontWeight: 700, color: "#6E7AAB" }}>:</span>
            <input
              className="dmt-input dmt-secs"
              value={secs}
              onChange={(event: any) => setSecs(event.target.value)}
              onKeyDown={(event: any) => {
                if (event.key === "Enter" && !event.nativeEvent?.isComposing) {
                  event.preventDefault();
                  onAdd();
                }
              }}
              placeholder={t("secondsPlaceholder")}
              aria-label={t("secondsPlaceholder")}
              inputMode="numeric"
              spellCheck={false}
              style={{
                width: px(26),
                height: "100%",
                padding: 0,
                border: "none",
                background: "transparent",
                color: "#2F3B7A",
                fontFamily: FONT,
                fontSize: px(12),
                fontWeight: 600,
                textAlign: "left",
                outline: "none",
              }}
            />
          </div>
          <input
            className="dmt-input"
            value={note}
            onChange={(event: any) => setNote(event.target.value)}
            onKeyDown={(event: any) => {
              if (event.key === "Enter" && !event.nativeEvent?.isComposing) {
                event.preventDefault();
                onAdd();
              }
            }}
            placeholder={t("notePlaceholder")}
            aria-label={t("notePlaceholder")}
            spellCheck={false}
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              height: "100%",
              boxSizing: "border-box",
              padding: `0 ${px(11)}px`,
              borderRadius: px(999),
              border: "1.4px solid #C2D0F1",
              background: "#F8FAFF",
              color: "#2F3B7A",
              fontFamily: FONT,
              fontSize: px(12),
              outline: "none",
            }}
          />
          <button
            className="dmt-add"
            type="button"
            title={t("addStage")}
            aria-label={t("addStage")}
            onClick={onAdd}
            style={{
              flex: "0 0 auto",
              width: px(32),
              height: px(32),
              borderRadius: "50%",
              border: "1px solid #4B5FC8",
              background: "linear-gradient(180deg,#7E96EC,#5165CE)",
              color: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxShadow: "0 3px 8px rgba(64,82,190,.34)",
              padding: 0,
            }}
          >
            <IconPlus size={px(14)} />
          </button>
        </div>

        {hint ? (
          <div
            className="dmt-pop"
            style={{
              position: "absolute",
              right: "3.4%",
              top: "82.4%",
              transform: "translateY(-118%)",
              padding: `${px(4)}px ${px(10)}px`,
              borderRadius: px(999),
              background: "rgba(48,60,120,.92)",
              color: "#FFFFFF",
              fontSize: px(10.5),
              whiteSpace: "nowrap",
              pointerEvents: "none",
              zIndex: 30,
            }}
          >
            {hint}
          </div>
        ) : null}

        {/* width grip */}
        <div
          ref={gripRef}
          className="dmt-grip"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          onDoubleClick={() => setState((s) => ({ ...s, width: 0 }))}
          title={t("resizeHint")}
          style={{
            position: "absolute",
            right: px(4),
            bottom: px(3),
            width: px(18),
            height: px(18),
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "flex-end",
            padding: px(3),
          }}
        >
          <svg width={px(11)} height={px(11)} viewBox="0 0 12 12" fill="none" stroke="#8FA0D0" strokeWidth="1.5" strokeLinecap="round">
            <path d="M11 4 L4 11" />
            <path d="M11 8 L8 11" />
          </svg>
        </div>

        {/* delete menu */}
        {menu ? (
          <div
            ref={menuRef}
            className="dmt-pop"
            style={{
              position: "fixed",
              left: menu.x,
              top: menu.y,
              minWidth: px(168),
              padding: `${px(4)}px`,
              borderRadius: px(10),
              background: "#FFFFFF",
              border: "1px solid #E2C7C7",
              boxShadow: "0 12px 26px rgba(40,50,110,.22)",
              zIndex: 90,
              color: "#33417F",
              fontSize: px(12),
            }}
            onContextMenu={(event: any) => event.preventDefault()}
          >
            <div
              style={{
                padding: `${px(4)}px ${px(9)}px ${px(5)}px`,
                color: "#6E7AAB",
                fontSize: px(10),
                maxWidth: px(210),
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {menu.note || t("noteDefault")}
            </div>
            <button
              className="dmt-menuItem"
              type="button"
              onClick={() => {
                setState((s) => deleteStage(s, menu.id));
                setMenu(null);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: `${px(6)}px ${px(9)}px`,
                borderRadius: px(7),
                border: "none",
                background: "transparent",
                color: "#C23A3A",
                fontFamily: FONT,
                fontSize: px(12),
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {t("deleteStage")} · {fmtHM(menu.ms)}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Stat(props: any) {
  const px = props.px;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: px(1) }}>
      <span style={{ fontSize: px(9.5), color: "#5F6B9E", letterSpacing: px(0.3) }}>{props.label}</span>
      <span
        style={{
          fontSize: px(12),
          fontWeight: 600,
          color: "#46548F",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {props.value}
      </span>
    </div>
  );
}

function iconButton(size: number, px: (n: number) => number) {
  return {
    flex: "0 0 auto",
    width: size,
    height: size,
    borderRadius: "50%",
    border: "1px solid #C7D4F2",
    background: "#FFFFFF",
    color: "#4A5AB8",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    cursor: "pointer",
  };
}

/* ------------------------------------------------------------------ wiring */

/**
 * Report one boot-progress marker to the host half's diagnostic route. The
 * renderer's console is unreachable from outside the Desktop window, so without
 * this a client-side boot failure looks exactly like "the plugin does nothing".
 */
/**
 * The window title is the only channel out of the Desktop renderer that the
 * outside world can read (its console is unreachable), so boot progress is also
 * mirrored there while diagnosing.
 */
function mark(stage: string): void {
  try {
    document.title = "MT:" + stage;
  } catch (e) {
    /* no document */
  }
}

function beacon(stage: string, extra?: Record<string, unknown>): void {
  try {
    const body = JSON.stringify({ stage, at: new Date().toISOString(), ...(extra || {}) });
    const sent = fetch("/_dsh/dsh-month-timer/beacon", { method: "POST", body, keepalive: true });
    if (sent && typeof sent.catch === "function") sent.catch(() => undefined);
  } catch (e) {
    /* diagnostics are best-effort only */
  }
}

/**
 * The `slots` service can become available *after* `apply` runs: the client
 * boots plugins before every service is mounted, so `ctx.slots` may be absent at
 * this point. Read it defensively (both the inject attribute and `ctx.get`), and
 * let the caller retry with backoff instead of giving up on the first miss —
 * a single check here is what silently kept the banner unregistered.
 */
function readSlots(ctx: any): any {
  try {
    if (ctx && ctx.slots && typeof ctx.slots.inject === "function") return ctx.slots;
  } catch (e) {
    /* the inject attribute throws while the service is still absent */
  }
  try {
    if (ctx && typeof ctx.get === "function") {
      const viaGet = ctx.get("slots");
      if (viaGet && typeof viaGet.inject === "function") return viaGet;
    }
  } catch (e) {
    /* service not mounted yet */
  }
  return null;
}

/** Register the stylesheet once the context is usable (effect-scoped when possible). */
function installStyles(ctx: any): void {
  const apply = () => {
    const style = document.createElement("style");
    style.setAttribute("data-dsh-month-timer", "");
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => {
      try {
        style.remove();
      } catch (e) {
        /* already detached */
      }
    };
  };
  try {
    if (typeof ctx.effect === "function") ctx.effect(apply, "dsh-month-timer: styles");
    else apply();
  } catch (e) {
    try {
      apply();
    } catch (err) {
      /* a missing <head> is not worth failing the plugin for */
    }
  }
}

function registerSlots(ctx: any, slots: any): void {
  t = createTranslator(ctx);
  lang = getLang();
  installStyles(ctx);

  try {
    slots.inject("shell.overlay", () =>
      slots.register(
        { name: "shell.overlay", id: NS_ID, order: 40, label: "月度累积计时器" },
        MonthTimerWidget
      )
    );
  } catch (e) {
    /* slot missing in this build: nothing to render */
  }

  try {
    slots.inject("conversation.composer.dock", () =>
      slots.register({ name: "conversation.composer.dock", id: NS_ANCHOR, order: 90 }, AnchorProbe)
    );
  } catch (e) {
    /* no composer dock: the widget falls back to the viewport centre */
  }
}

export function mount(ctx: any): void {
  mark("apply");
  beacon("apply");
  // The card reads the store in its useState initialiser, so a data import has
  // to land before the widget mounts: run it here, ahead of the slot lookup.
  try {
    applySeed();
  } catch (e) {
    /* applySeed already swallows its own errors; this is belt and braces */
  }
  // Wait (with backoff) for the slots service instead of bailing on the first
  // look: ~45s of coverage, the same ceiling the shipped bundles use.
  let attempts = 0;
  const attempt = () => {
    const slots = readSlots(ctx);
    if (slots) {
      mark("slots:" + attempts);
      try {
        registerSlots(ctx, slots);
        beacon("registered", { attempts });
        mark("ok:" + attempts);
        try {
          window.setTimeout(() => {
            mark("dom:" + (document.querySelector(".dmt-card") ? 1 : 0));
          }, 1500);
        } catch (e) {
          /* no timers */
        }
      } catch (e: any) {
        beacon("register-error", { attempts, message: e && e.message ? e.message : String(e) });
        mark("err:" + String((e && e.message) || e).slice(0, 60));
      }
      return;
    }
    attempts += 1;
    if (attempts > 120) {
      beacon("slots-timeout", { attempts });
      mark("noslots");
      return;
    }
    const delay = Math.min(200 + attempts * 25, 1000);
    try {
      window.setTimeout(attempt, delay);
    } catch (e) {
      /* no timers: give up quietly */
    }
  };
  attempt();
}
