import type { RouterHistory } from "vue-router";

const discardListeners = new Set<(firstDiscardedPosition: number) => void>();

/** 新 push 会替换当前位置之后的整个分支；Back/Forward 和 replace 保留它。 */
export function onHistoryBranchDiscarded(listener: (firstDiscardedPosition: number) => void) {
  discardListeners.add(listener);
  return () => { discardListeners.delete(listener); };
}

/** 页面路由与浮层都通过 RouterHistory.push 写历史，在同一处通知缓存回收。 */
export function trackHistoryBranches(history: RouterHistory) {
  const push = history.push;
  const trackedPush: RouterHistory["push"] = (to, data) => {
    push.call(history, to, data);
    const position = history.state.position;
    if (typeof position === "number") {
      for (const listener of discardListeners) listener(position);
    }
  };
  history.push = trackedPush;
  return () => {
    if (history.push === trackedPush) history.push = push;
  };
}
