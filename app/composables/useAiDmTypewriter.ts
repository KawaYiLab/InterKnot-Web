/**
 * AI 私信放字：仅对「会话打开之后新到达」的 AI 文本消息逐字展示。
 *
 * 一次性到达的全文和流式增量走同一套：每条消息记一个目标文本，按帧把已展示的长度
 * 推向目标。速度随积压自适应——积压越多放得越快（约 CATCH_UP_SEC 内追上），积压少时
 * 不低于 MIN_CPS。所以后端不论是 16 字一批还是一次推一大段，看到的都是匀速逐字；
 * 流式结束后也会把剩下的字放完，而不是整段跳出来。
 *
 * 系统开了「减少动态效果」时不放字，直接展示全文。
 */
const MIN_CPS = 30;
const CATCH_UP_SEC = 0.6;
/** 标签页切走回来时 rAF 的间隔会很大，按这个上限算，交给积压加速去追 */
const MAX_FRAME_MS = 64;

type Pace = {
  /** 目标文本（流式时是当前累计的全文） */
  target: string;
  /** 已展示到的位置（UTF-16 下标，带小数） */
  shown: number;
  /** 还会继续增长（流式中）：追上目标后等下一份，不算完成 */
  open: boolean;
};

const prefersReducedMotion = (): boolean =>
  import.meta.client && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 截断位置不要落在代理对中间（emoji 等） */
const safeCut = (text: string, index: number): number => {
  if (index <= 0 || index >= text.length) return Math.max(0, Math.min(index, text.length));
  const code = text.charCodeAt(index - 1);
  return code >= 0xd800 && code <= 0xdbff ? index + 1 : index;
};

const paces = new Map<string, Pace>();
let frame: number | null = null;
let lastFrameAt = 0;

export function useAiDmTypewriter() {
  const revealText = useState<Record<string, string>>("dm-ai-reveal-text", () => ({}));
  const completed = useState<Set<string>>("dm-ai-reveal-done", () => new Set());
  /** 逐字更新时递增，供列表订阅；避免每帧展开整个 revealText 对象 */
  const revealTick = useState("dm-ai-reveal-tick", () => 0);

  const bumpReveal = () => {
    revealTick.value++;
  };

  const isComplete = (documentId: string): boolean =>
    completed.value.has(documentId);

  const isRevealing = (documentId: string): boolean =>
    revealText.value[documentId] != null && !completed.value.has(documentId);

  /**
   * @param animate false 时始终返回全文（历史消息 / 非 AI 会话）
   */
  const displayText = (documentId: string, fullText: string, animate: boolean): string => {
    if (!animate || completed.value.has(documentId)) return fullText;
    const partial = revealText.value[documentId];
    if (typeof partial === "string") return partial;
    return fullText;
  };

  const cancelReveal = (documentId: string) => {
    paces.delete(documentId);
  };

  const markComplete = (documentId: string, fullText: string) => {
    cancelReveal(documentId);
    const nextDone = new Set(completed.value);
    nextDone.add(documentId);
    completed.value = nextDone;
    revealText.value[documentId] = fullText;
    bumpReveal();
  };

  const tick = (now: number) => {
    const dt = Math.min(now - lastFrameAt, MAX_FRAME_MS) / 1000;
    lastFrameAt = now;
    let changed = false;
    for (const [id, pace] of paces) {
      const backlog = pace.target.length - pace.shown;
      if (backlog > 0) {
        const cps = Math.max(MIN_CPS, backlog / CATCH_UP_SEC);
        pace.shown = Math.min(pace.target.length, pace.shown + cps * dt);
        const next = pace.target.slice(0, safeCut(pace.target, Math.floor(pace.shown)));
        if (revealText.value[id] !== next) {
          revealText.value[id] = next;
          changed = true;
        }
      } else if (!pace.open) {
        markComplete(id, pace.target);
      }
    }
    if (changed) bumpReveal();
    frame = paces.size ? requestAnimationFrame(tick) : null;
  };

  const ensureLoop = () => {
    if (frame != null) return;
    lastFrameAt = performance.now();
    frame = requestAnimationFrame(tick);
  };

  /** 历史消息：直接标记完成，不播放打字机 */
  const primeCompleted = (documentIds: string[]) => {
    if (!documentIds.length) return;
    const nextDone = new Set(completed.value);
    for (const id of documentIds) {
      cancelReveal(id);
      nextDone.add(id);
      delete revealText.value[id];
    }
    completed.value = nextDone;
    bumpReveal();
  };

  /**
   * 设定 / 更新一条消息的放字目标；重复调用只换目标，不会从头再放。
   * @param open 流式中（后面还有增量）：放到目标后停住等下一份，不标记完成
   */
  const startReveal = (documentId: string, fullText: string, open = false) => {
    if (completed.value.has(documentId)) return;
    const text = fullText.trim();
    const pace = paces.get(documentId);
    if (!text) {
      if (pace && !open) markComplete(documentId, "");
      return;
    }
    if (prefersReducedMotion() || typeof requestAnimationFrame === "undefined") {
      markComplete(documentId, text);
      return;
    }
    if (pace) {
      pace.target = text;
      pace.open = open;
      pace.shown = Math.min(pace.shown, text.length);
    } else {
      paces.set(documentId, { target: text, shown: 0, open });
      revealText.value[documentId] = "";
      bumpReveal();
    }
    ensureLoop();
  };

  const resetSession = () => {
    paces.clear();
    if (frame != null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    for (const key of Object.keys(revealText.value)) {
      delete revealText.value[key];
    }
    completed.value = new Set();
    bumpReveal();
  };

  return {
    displayText,
    isComplete,
    isRevealing,
    startReveal,
    markComplete,
    primeCompleted,
    resetSession,
    revealTick: computed(() => revealTick.value),
  };
}
