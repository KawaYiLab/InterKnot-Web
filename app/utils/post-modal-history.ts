import type { HistoryState, Router } from "vue-router";

let postModalHandler: (() => void) | null = null;
let knockModalHandler: (() => void) | null = null;
let pendingRestore: object | null = null;
let resumeRestoreRouter: (() => void) | null = null;
let backgroundSyncs = 0;

export const isSyncingModalBackground = () => backgroundSyncs > 0;

/** 快速前进再后退时，取消尚未完成的页面导航；重复 replace 不改变历史项。 */
export function cancelPendingModalNavigation(router: Router) {
  backgroundSyncs++;
  void router.replace(router.currentRoute.value.fullPath).finally(() => { backgroundSyncs--; });
}

export function dispatchPostModalPopState() {
  resumeRestoreRouter?.();
  pendingRestore = null;
  postModalHandler?.();
  knockModalHandler?.();
}

/** 从个人页等真实路由返回浮层时，先恢复背景路由，再还原这一条历史的地址。 */
export function restoreModalBackground(router: Router, route: string, position: unknown) {
  // 帖子和敲敲可共用一条历史，交给先处理的上层帖子恢复背景。
  if (pendingRestore) return;
  const request = {};
  pendingRestore = request;
  const url = window.location.pathname + window.location.search + window.location.hash;
  const previousState = window.history.state;
  const backgroundPosition = previousState?.modalBackgroundRoute === route
    ? previousState.modalBackgroundPosition : position;
  const state = { ...previousState, modalBackgroundRoute: route, modalBackgroundPosition: backgroundPosition };
  const listening = router.listening;
  router.listening = false;
  const resume = () => {
    if (resumeRestoreRouter !== resume) return;
    router.listening = listening;
    resumeRestoreRouter = null;
  };
  resumeRestoreRouter = resume;
  // 先让 RouterHistory 的 popstate listener 记住落点和 position。
  setTimeout(async () => {
    resume();
    if (pendingRestore !== request) return;
    try {
      if (window.location.pathname + window.location.search + window.location.hash !== url) return;
      const target = router.resolve(route);
      const failure = await router.replace({
        path: target.path, query: target.query, hash: target.hash,
        state: { modalBackgroundRoute: route, modalBackgroundPosition: backgroundPosition } as HistoryState,
      });
      if (failure || pendingRestore !== request || window.history.state?.position !== state.position) return;
      for (const key of ["back", "current", "forward", "position", "replaced", "scroll"]) delete state[key];
      router.options.history.replace(url, state as HistoryState);
      dispatchPostModalPopState();
    } finally {
      if (pendingRestore === request) pendingRestore = null;
    }
  }, 0);
}

/** 共用先于 RouterHistory 注册的 listener，先处理上层帖子，再处理敲敲。 */
export function registerKnockModalPopState(handler: () => void) {
  knockModalHandler = handler;
  return () => {
    if (knockModalHandler === handler) knockModalHandler = null;
  };
}

export function registerPostModalPopState(handler: () => void) {
  postModalHandler = handler;
  return () => {
    if (postModalHandler === handler) postModalHandler = null;
  };
}
