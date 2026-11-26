/**
 * Text for the widget. Strings are registered with the shell locale service so
 * the plugin follows the app language; a local dictionary keeps it readable if
 * that service is unavailable.
 */

export const NAMESPACE = "dsh-month-timer";

export const ZH: Record<string, string> = {
  pickMonth: "选择月份",
  meta: "{d} 个工作日 · 节点 {n}",
  notDone: "未完成",
  done: "已完成",
  thisMonth: "本月累计",
  stages: "阶段",
  toNode: "距节点",
  progress: "达成",
  reached: "已达成",
  collapse: "收起",
  expand: "展开",
  minutesPlaceholder: "分",
  secondsPlaceholder: "秒",
  notePlaceholder: "这段时长做什么，写一句备注",
  addStage: "记一段时长",
  noteDefault: "未备注",
  duration: "时长",
  resizeHint: "拖动调宽 · 双击恢复跟随对话栏",
  deleteStage: "删除该阶段",
  rightClickDelete: "右键色块可删除",
  emptyHint: "还没有记录，填好时长点 + 加一段",
  emptyHintView: "这个月还没有记录",
  hintNeedMinutes: "先填一个大于 0 的分钟数呀",
  hintNoNote: "已记录（这段没写备注）",
  nodeTipTitle: "界定节点",
  nodeTipBody: "{d} 个工作日 × {m} 分钟 = {n}",
  nodeTipMeta: "进度越过这里，本月就算完成啦",
  modeTitle: "界定节点倍率",
  modeRow: "每个工作日 × {m}",
  minuteSecond: "分:秒",
  viewing: "仅查看",
  viewingTip: "这个月只用来查看，新记录仍然记入当月",
  daysShort: "{n}天",
  appearance: "外观",
  background: "背景",
  bgPaper: "纸面",
  bgGlass: "毛玻璃",
  bgClear: "透明",
  placement: "位置",
  placeTop: "页面上方",
  placeBottom: "页面下方",
};

export const EN: Record<string, string> = {
  pickMonth: "Pick a month",
  meta: "{d} workdays · node {n}",
  notDone: "In progress",
  done: "Completed",
  thisMonth: "This month",
  stages: "Stages",
  toNode: "To node",
  progress: "Reached",
  reached: "Reached",
  collapse: "Collapse",
  expand: "Expand",
  minutesPlaceholder: "min",
  secondsPlaceholder: "sec",
  notePlaceholder: "What was this stretch about?",
  addStage: "Add a stretch",
  noteDefault: "No note",
  duration: "Duration",
  resizeHint: "Drag to resize · double-click to follow the chat column",
  deleteStage: "Delete this stage",
  rightClickDelete: "Right-click a segment to delete",
  emptyHint: "Nothing logged yet — fill in minutes and press +",
  emptyHintView: "No records in this month yet",
  hintNeedMinutes: "Enter a minute value above 0 first",
  hintNoNote: "Saved without a note",
  nodeTipTitle: "Threshold node",
  nodeTipBody: "{d} workdays × {m} min = {n}",
  nodeTipMeta: "Crossing this line completes the month",
  modeTitle: "Threshold multiplier",
  modeRow: "× {m} per workday",
  minuteSecond: "min:sec",
  viewing: "View only",
  viewingTip: "This month is read-only; new records still go to the current month",
  daysShort: "{n}d",
  appearance: "Appearance",
  background: "Background",
  bgPaper: "Paper",
  bgGlass: "Frosted",
  bgClear: "Clear",
  placement: "Position",
  placeTop: "Top of page",
  placeBottom: "Bottom",
};

const DICTS = { zh: ZH, en: EN };

let currentLang = "zh";

export function getLang(): string {
  return currentLang;
}

function interpolate(template: string, vars?: Record<string, any>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    vars[key] === undefined || vars[key] === null ? whole : String(vars[key])
  );
}

export function createTranslator(ctx: any): (key: string, vars?: Record<string, any>) => string {
  let bound: any = null;
  // Reading a service property the plugin did not declare in `inject` THROWS in
  // the client runtime ("cannot get property ... without inject"), so go through
  // ctx.get first and keep the property read behind its own try. A missing locale
  // service must degrade to the local dictionary, never abort registration.
  let service: any = null;
  try {
    if (ctx && typeof ctx.get === "function") service = ctx.get("locale") || null;
  } catch (e) {
    service = null;
  }
  if (!service) {
    try {
      service = ctx && ctx.locale ? ctx.locale : null;
    } catch (e) {
      service = null;
    }
  }

  try {
    if (service && typeof service.register === "function") {
      service.register(NAMESPACE, DICTS);
    }
    if (service && typeof service.bind === "function") {
      bound = service.bind(NAMESPACE);
    }
    if (service && typeof service.getLocale === "function") {
      const locale = service.getLocale();
      const code = typeof locale === "string" ? locale : locale && (locale.id || locale.locale);
      if (typeof code === "string" && code) currentLang = code;
    }
  } catch (e) {
    bound = null;
  }

  const dict = String(currentLang).toLowerCase().indexOf("zh") === 0 ? ZH : EN;

  return function translate(key: string, vars?: Record<string, any>): string {
    let text: any = null;
    if (bound) {
      try {
        text = bound(key, vars);
      } catch (e) {
        text = null;
      }
    }
    if (typeof text !== "string" || !text || text === key) {
      text = dict[key] !== undefined ? dict[key] : ZH[key] !== undefined ? ZH[key] : key;
    }
    return interpolate(text, vars);
  };
}
