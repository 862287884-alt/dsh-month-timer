/**
 * Persistence + accounting model for the monthly cumulative timer.
 *
 * Every month owns one ledger: committed stages plus the not-yet-committed
 * "pending" span of the running stopwatch. The bar's scale is fixed per month
 * (node * 2), where node = weekdays(Mon-Fri) * N hours (N = 2 or 3, switchable).
 */

export const STORE_KEY = "dsh-month-timer.store.v1";
export const HOUR_MS = 3600 * 1000;
export const MIN_MS = 60 * 1000;

/** The threshold node is weekdays × N MINUTES; N is switchable at runtime. */
export const NODE_MODES = [2, 3];
export const DEFAULT_NODE_MODE = 3;
export const DEFAULT_BACKDROP: Backdrop = "glass";
export const DEFAULT_PLACEMENT: Placement = "bottom";
export const BACKDROPS: Backdrop[] = ["paper", "glass", "clear"];
export const PLACEMENTS: Placement[] = ["top", "bottom"];

export const MIN_WIDTH = 700;
export const MAX_WIDTH = 1600;
export const DEFAULT_WIDTH = 880;

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Blue / lavender / teal family that stays legible on the periwinkle track. */
export const PALETTE = [
  "#5B6FE0",
  "#4FB3D9",
  "#8E6FE0",
  "#E06FA8",
  "#F0A04B",
  "#4FAE86",
  "#D9C24B",
  "#E0705F",
  "#7E9BE0",
  "#B06FE0",
  "#3FAFA0",
  "#C98F3B",
];

export type Stage = {
  id: string;
  ms: number;
  note: string;
  at: string;
  color: string;
};

export type MonthRecord = {
  stages: Stage[];
  pendingMs: number;
};

export type Backdrop = "paper" | "glass" | "clear";
export type Placement = "top" | "bottom";

export type Store = {
  version: number;
  width: number;
  collapsed: boolean;
  paused: boolean;
  month: string;
  nodeMode: number;
  /** How the card sits on the page: opaque paper, frosted glass, or see-through. */
  bg: Backdrop;
  /** Where the widget is pinned: above the composer or at the top of the page. */
  position: Placement;
  months: Record<string, MonthRecord>;
  lastTick: number;
};

export function pad2(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

export function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

export function monthKeyOf(date: Date): string {
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1);
}

export function parseMonthKey(key: string): { y: number; m: number } {
  const parts = String(key).split("-");
  return { y: Number(parts[0]) || 1970, m: Number(parts[1]) || 1 };
}

function keyFromIndex(index: number): string {
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return y + "-" + pad2(m);
}

/** Weekdays only (Mon-Fri); no public-holiday calendar is applied. */
export function workdaysInMonth(key: string): number {
  const { y, m } = parseMonthKey(key);
  const cursor = new Date(y, m - 1, 1);
  let count = 0;
  while (cursor.getMonth() === m - 1) {
    const weekday = cursor.getDay();
    if (weekday >= 1 && weekday <= 5) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export function nodeMinutesOf(key: string, mode?: number): number {
  const mult = mode === 2 || mode === 3 ? mode : DEFAULT_NODE_MODE;
  return workdaysInMonth(key) * mult;
}

/** Is the month on screen the one the clock is accruing into? */
export function isCurrentMonth(key: string, now?: Date): boolean {
  return key === monthKeyOf(now ?? new Date());
}

export function emptyRecord(): MonthRecord {
  return { stages: [], pendingMs: 0 };
}

export function monthRecord(state: Store, key: string): MonthRecord {
  const found = state.months[key];
  if (!found) return emptyRecord();
  return {
    stages: Array.isArray(found.stages) ? found.stages : [],
    pendingMs: Number.isFinite(found.pendingMs) ? found.pendingMs : 0,
  };
}

function uid(): string {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

export function normalizeStage(raw: any): Stage | null {
  if (!raw || typeof raw !== "object") return null;
  const ms = Number(raw.ms);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
    ms: Math.round(ms),
    note: typeof raw.note === "string" ? raw.note : "",
    at: typeof raw.at === "string" ? raw.at : new Date().toISOString(),
    color: typeof raw.color === "string" && raw.color ? raw.color : PALETTE[0],
  };
}

export function loadStore(storage?: Storage): Store {
  let raw: string | null = null;
  try {
    const box = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (box) raw = box.getItem(STORE_KEY);
  } catch (e) {
    raw = null;
  }

  let saved: any = null;
  if (raw) {
    try {
      saved = JSON.parse(raw);
    } catch (e) {
      saved = null;
    }
  }

  const now = new Date();
  const today = monthKeyOf(now);
  const source = saved && typeof saved === "object" ? saved : {};
  const months: Record<string, MonthRecord> = {};

  if (source.months && typeof source.months === "object") {
    Object.keys(source.months).forEach((key) => {
      if (!MONTH_RE.test(key)) return;
      const entry = source.months[key] || {};
      const stages: Stage[] = Array.isArray(entry.stages)
        ? entry.stages.map(normalizeStage).filter(Boolean) as Stage[]
        : [];
      const pending = Number(entry.pendingMs);
      const carried = Number.isFinite(pending) && pending >= 1000 ? Math.round(pending) : 0;
      // The stopwatch is gone: any time the old build accumulated but never
      // committed becomes a normal stage instead of being silently dropped.
      if (carried > 0) {
        stages.push({
          id: "carried-" + key,
          ms: carried,
          note: "",
          at: new Date().toISOString(),
          color: PALETTE[stages.length % PALETTE.length],
        });
      }
      months[key] = { stages, pendingMs: 0 };
    });
  }

  return {
    version: 1,
    width: typeof source.width === "number" && source.width > 0 ? source.width : 0,
    collapsed: !!source.collapsed,
    paused: false,
    month: typeof source.month === "string" && MONTH_RE.test(source.month) ? source.month : today,
      nodeMode: source.nodeMode === 2 || source.nodeMode === 3 ? source.nodeMode : DEFAULT_NODE_MODE,
    bg: BACKDROPS.indexOf(source.bg) >= 0 ? source.bg : DEFAULT_BACKDROP,
    position: PLACEMENTS.indexOf(source.position) >= 0 ? source.position : DEFAULT_PLACEMENT,
    months,
    lastTick: now.getTime(),
  };
}

/** JSON payload written to storage (lastTick is runtime-only). */
export function serialize(state: Store): string {
  const months: Record<string, MonthRecord> = {};
  Object.keys(state.months).forEach((key) => {
    const rec = state.months[key];
    if (!rec) return;
    if (!rec.stages.length && rec.pendingMs < 1) return;
    months[key] = {
      stages: rec.stages.map((s) => ({
        id: s.id,
        ms: Math.round(s.ms),
        note: s.note,
        at: s.at,
        color: s.color,
      })),
      pendingMs: Math.round(rec.pendingMs),
    };
  });
  return JSON.stringify({
    version: 1,
    width: state.width > 0 ? Math.round(state.width) : 0,
    collapsed: state.collapsed,
    paused: state.paused,
    month: state.month,
    nodeMode: state.nodeMode === 2 ? 2 : 3,
    bg: BACKDROPS.indexOf(state.bg) >= 0 ? state.bg : DEFAULT_BACKDROP,
    position: PLACEMENTS.indexOf(state.position) >= 0 ? state.position : DEFAULT_PLACEMENT,
    months,
  });
}

export function saveStore(state: Store, storage?: Storage): void {
  try {
    const box = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (box) box.setItem(STORE_KEY, serialize(state));
  } catch (e) {
    /* storage full or blocked: the timer keeps working in memory */
  }
}

function hashNote(note: string): number {
  let hash = 0;
  for (let i = 0; i < note.length; i += 1) {
    hash = (hash * 31 + note.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function pickColor(note: string, stages: Stage[]): string {
  const used = stages.map((s) => s.color);
  // Walk the palette in order so a fresh month starts with the signature blue
  // and neighbouring stages never share a colour.
  for (let step = 0; step < PALETTE.length; step += 1) {
    const candidate = PALETTE[(stages.length + step) % PALETTE.length];
    if (used.indexOf(candidate) === -1) return candidate;
  }
  return PALETTE[hashNote(note || "·") % PALETTE.length];
}

/**
 * One stopwatch step. Time only accrues while the widget is running and the
 * document is visible; a single step is capped so machine sleep or a long
 * blocked frame cannot invent hours.
 */
export function refreshMonth(state: Store, now: number): Store {
  const today = monthKeyOf(new Date(now));
  // The view follows the calendar at midnight, but only when it was showing
  // "the" current month; a month the user deliberately opened stays put.
  if (state.month === monthKeyOf(new Date(now - 60000)) && state.month !== today) {
    return { ...state, month: today, lastTick: now };
  }
  return state.lastTick === now ? state : { ...state, lastTick: now };
}

/**
 * Add one hand-entered span. Durations are typed by the user — nothing accrues
 * on its own any more, so this is the only writer of `stages`.
 */
export function addStage(
  state: Store,
  ms: number,
  note: string,
  month?: string
): { state: Store; ok: boolean } {
  const target = month && MONTH_RE.test(month) ? month : state.month;
  const value = Math.round(ms);
  if (!Number.isFinite(value) || value <= 0) return { state, ok: false };
  const rec = monthRecord(state, target);
  const clean = note.trim();
  const stage: Stage = {
    id: uid(),
    ms: value,
    note: clean,
    at: new Date().toISOString(),
    color: pickColor(clean, rec.stages),
  };
  return {
    state: {
      ...state,
      lastTick: Date.now(),
      months: {
        ...state.months,
        [target]: { stages: rec.stages.concat([stage]), pendingMs: 0 },
      },
    },
    ok: true,
  };
}

export function deleteStage(state: Store, id: string): Store {
  const rec = monthRecord(state, state.month);
  const stages = rec.stages.filter((s) => s.id !== id);
  if (stages.length === rec.stages.length) return state;
  return {
    ...state,
    months: { ...state.months, [state.month]: { stages, pendingMs: rec.pendingMs } },
  };
}

export function toggleCollapsed(state: Store): Store {
  return { ...state, collapsed: !state.collapsed };
}

export function setBackdrop(state: Store, bg: Backdrop): Store {
  if (bg === state.bg) return state;
  return { ...state, bg };
}

export function setPlacement(state: Store, position: Placement): Store {
  if (position === state.position) return state;
  return { ...state, position };
}

export function setNodeMode(state: Store, mode: number): Store {
  const next = mode === 2 ? 2 : 3;
  if (next === state.nodeMode) return state;
  return { ...state, nodeMode: next };
}

export function selectMonth(state: Store, key: string): Store {
  if (!MONTH_RE.test(key) || key === state.month) return state;
  return { ...state, month: key, lastTick: Date.now() };
}

export function monthOptions(state: Store, now?: Date): { key: string; workdays: number }[] {
  const base = (now ?? new Date());
  const index = base.getFullYear() * 12 + base.getMonth();
  const keys: Record<string, true> = {};
  // Past twelve months up to the current one; future months are not offered
  // because the timer would have nowhere honest to put that time.
  for (let i = -12; i <= 0; i += 1) keys[keyFromIndex(index + i)] = true;
  Object.keys(state.months).forEach((key) => {
    if (MONTH_RE.test(key)) keys[key] = true;
  });
  if (MONTH_RE.test(state.month)) keys[state.month] = true;
  return Object.keys(keys)
    .sort()
    .reverse()
    .map((key) => ({ key, workdays: workdaysInMonth(key) }));
}

const EN_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function monthLabel(key: string, lang: string): string {
  const { y, m } = parseMonthKey(key);
  if (String(lang || "zh").toLowerCase().indexOf("zh") === 0) return y + "年" + m + "月";
  return EN_MONTHS[Math.max(0, Math.min(11, m - 1))] + " " + y;
}

/**
 * Every figure in this widget is minutes:seconds. Minutes are never folded into
 * hours, so 1h 1m 59s reads 61:59 and 70h reads 4200:00.
 */
export function fmtClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ":" + pad2(s);
}

/** Durations use the same unit as the clock (no hour conversion). */
export function fmtHM(ms: number): string {
  return fmtClock(ms);
}

/** Threshold label: the node is already a minute count, so it reads "63分". */
export function fmtNode(minutes: number): string {
  return Math.round(minutes) + "分";
}

export function fmtDate(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  return (
    date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate()) +
    " " + pad2(date.getHours()) + ":" + pad2(date.getMinutes())
  );
}

export function fmtPercent(frac: number): string {
  const pct = Math.max(0, frac) * 100;
  return (pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)) + "%";
}
