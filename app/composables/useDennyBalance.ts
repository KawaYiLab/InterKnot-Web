import { computed, watch } from "vue";
import { useEventListener } from "@vueuse/core";

/** 顶栏直接使用会话资料中的余额；旧后端和无余额的变更事件才补查。 */
export function useDennyBalance() {
  const auth = useAuthStore();
  const api = useApi();
  const balance = computed(() => auth.isLogin ? auth.user?.denny ?? 0 : 0);
  let revision = 0;
  let pending: { generation: number; revision: number; promise: Promise<void> } | null = null;

  const refresh = (): Promise<void> => {
    if (!auth.isLogin || !auth.user) return Promise.resolve();
    const generation = auth.generation;
    const currentRevision = revision;
    if (pending?.generation === generation && pending.revision === currentRevision) return pending.promise;
    const promise = api.getMyDenny().then((data) => {
      // 登录切换、签到或投币期间的旧余额不能覆盖新余额。
      if (auth.generation === generation && revision === currentRevision) {
        auth.updateUserPartial({ denny: data.denny });
      }
    }).catch(() => {
      // 网络失败保留已显示的余额，下次显式刷新重试。
    }).finally(() => {
      if (pending?.promise === promise) pending = null;
    });
    pending = { generation, revision: currentRevision, promise };
    return promise;
  };

  if (import.meta.client) {
    watch(() => auth.generation, () => { revision += 1; }, { flush: "sync" });
    watch([() => auth.user?.id ?? auth.user?.documentId, () => auth.user?.denny], () => {
      revision += 1;
      // 旧后端补全 author/头像不会重新拉余额，也不会使在途余额失效。
      if (auth.user && auth.user.denny === undefined) void refresh();
    }, { immediate: true, flush: "sync" });

    useEventListener(window, "ik:home-refresh", () => { void refresh(); });
    useEventListener(window, "ik:denny-decrement", () => {
      if (balance.value > 0) auth.updateUserPartial({ denny: balance.value - 1 });
    });
    useEventListener(window, "ik:denny-updated", (event: Event) => {
      const value = (event as CustomEvent<unknown>).detail;
      if (typeof value === "number" && Number.isFinite(value)) {
        auth.updateUserPartial({ denny: value });
      } else {
        void refresh();
      }
    });
  }

  return { balance, refresh };
}
