/**
 * AI 私信打字机：仅对「会话打开之后新到达」的 AI 文本消息逐字展示。
 */
const TICK_MS = 28;
const CHARS_PER_TICK = 2;

export function useAiDmTypewriter() {
  const revealText = useState<Record<string, string>>("dm-ai-reveal-text", () => ({}));
  const completed = useState<Set<string>>("dm-ai-reveal-done", () => new Set());
  /** 逐字更新时递增，供列表订阅；避免每 tick 展开整个 revealText 对象 */
  const revealTick = useState("dm-ai-reveal-tick", () => 0);
  const timers = new Map<string, ReturnType<typeof setInterval>>();

  const bumpReveal = () => {
    revealTick.value++;
  };

  const isComplete = (documentId: string): boolean =>
    completed.value.has(documentId);

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
    const t = timers.get(documentId);
    if (t) {
      clearInterval(t);
      timers.delete(documentId);
    }
  };

  const markComplete = (documentId: string, fullText: string) => {
    cancelReveal(documentId);
    const nextDone = new Set(completed.value);
    nextDone.add(documentId);
    completed.value = nextDone;
    revealText.value[documentId] = fullText;
    bumpReveal();
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

  const startReveal = (documentId: string, fullText: string) => {
    const text = fullText.trim();
    if (!text || completed.value.has(documentId)) return;

    cancelReveal(documentId);
    let index = 0;
    revealText.value[documentId] = "";

    const timer = setInterval(() => {
      index = Math.min(text.length, index + CHARS_PER_TICK);
      revealText.value[documentId] = text.slice(0, index);
      bumpReveal();
      if (index >= text.length) {
        markComplete(documentId, text);
      }
    }, TICK_MS);
    timers.set(documentId, timer);
  };

  const resetSession = () => {
    for (const t of timers.values()) clearInterval(t);
    timers.clear();
    for (const key of Object.keys(revealText.value)) {
      delete revealText.value[key];
    }
    completed.value = new Set();
    bumpReveal();
  };

  return {
    displayText,
    isComplete,
    startReveal,
    markComplete,
    primeCompleted,
    resetSession,
    revealTick: computed(() => revealTick.value),
  };
}
