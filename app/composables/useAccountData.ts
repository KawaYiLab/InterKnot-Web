import { useMessage } from "zenless-ui";
import { resolveErrorMessage } from "~/utils/api-error";
import type { AccountSecurity, AuthSessionItem, BlockedUser, MihoyoBinding } from "~/types/entities";

const STORAGE_KEY = "ik:account:data";
const STALE_TIME = 5 * 60 * 1000; // 5 分钟后重新拉取

interface AccountDataState {
  security: AccountSecurity | null;
  securityFetchedAt: number | null;
  mihoyoBinding: MihoyoBinding | null;
  mihoyoFetchedAt: number | null;
  blockedUsers: BlockedUser[];
  blockedHasNext: boolean;
  blockedCursor: string;
  blockedFetchedAt: number | null;
}

function defaultState(): AccountDataState {
  return {
    security: null,
    securityFetchedAt: null,
    mihoyoBinding: null,
    mihoyoFetchedAt: null,
    blockedUsers: [],
    blockedHasNext: true,
    blockedCursor: "",
    blockedFetchedAt: null,
  };
}

function isStale(fetchedAt: number | null) {
  return !fetchedAt || Date.now() - fetchedAt > STALE_TIME;
}

let _instance: ReturnType<typeof createAccountData> | null = null;

function createAccountData() {
  // Security and binding details stay in memory and are cleared on auth changes.
  if (import.meta.client) localStorage.removeItem(STORAGE_KEY);
  const state = ref<AccountDataState>(defaultState());

  const auth = useAuthStore();
  const api = useApi();
  const message = useMessage();

  const securityLoading = ref(false);
  const securityError = ref("");
  const mihoyoLoading = ref(false);
  const blockedLoading = ref(false);
  const mihoyoUnbinding = ref(false);

  const sessions = ref<AuthSessionItem[]>([]);
  const sessionsLoading = ref(false);
  const sessionsError = ref("");
  const sessionsRevoking = ref<number | "others" | null>(null);
  const sessionsFetchedAt = ref<number | null>(null);

  const security = computed(() => state.value.security);
  const securityFetchedAt = computed({
    get: () => state.value.securityFetchedAt,
    set: (v) => { state.value.securityFetchedAt = v; },
  });
  const mihoyoBinding = computed(() => state.value.mihoyoBinding);
  const mihoyoFetchedAt = computed({
    get: () => state.value.mihoyoFetchedAt,
    set: (v) => { state.value.mihoyoFetchedAt = v; },
  });
  const blockedUsers = computed(() => state.value.blockedUsers);
  const blockedHasNext = computed({
    get: () => state.value.blockedHasNext,
    set: (v) => { state.value.blockedHasNext = v; },
  });
  const blockedCursor = computed({
    get: () => state.value.blockedCursor,
    set: (v) => { state.value.blockedCursor = v; },
  });
  const blockedFetchedAt = computed({
    get: () => state.value.blockedFetchedAt,
    set: (v) => { state.value.blockedFetchedAt = v; },
  });

  const securityLoaded = computed(() => securityFetchedAt.value !== null);
  const mihoyoLoaded = computed(() => mihoyoFetchedAt.value !== null);
  const blockedLoaded = computed(() => blockedFetchedAt.value !== null);
  const sessionsLoaded = computed(() => sessionsFetchedAt.value !== null);

  const loadSecurity = async (force = false) => {
    const generation = auth.generation;
    if (!auth.isLogin || securityLoading.value) return;
    if (!force && !isStale(securityFetchedAt.value)) return;

    securityLoading.value = true;
    securityError.value = "";
    try {
      const result = await api.getMySecurity();
      if (generation !== auth.generation) return;
      state.value.security = result;
      securityFetchedAt.value = Date.now();
    } catch (err) {
      if (generation !== auth.generation) return;
      securityError.value = resolveErrorMessage(err, "获取账号安全信息失败");
      message.error(resolveErrorMessage(err, "获取账号安全信息失败"));
    } finally {
      if (generation === auth.generation) securityLoading.value = false;
    }
  };

  const loadMihoyo = async (force = false) => {
    const generation = auth.generation;
    if (!auth.isLogin || mihoyoLoading.value) return;
    if (!force && !isStale(mihoyoFetchedAt.value)) return;

    mihoyoLoading.value = true;
    try {
      const result = await api.getMihoyoBinding();
      if (generation !== auth.generation) return;
      state.value.mihoyoBinding = result;
      mihoyoFetchedAt.value = Date.now();
    } catch (err) {
      if (generation !== auth.generation) return;
      message.error(resolveErrorMessage(err, "获取米游社绑定信息失败"));
    } finally {
      if (generation === auth.generation) mihoyoLoading.value = false;
    }
  };

  const loadBlocked = async (opts: { reset?: boolean } = {}) => {
    const generation = auth.generation;
    if (!auth.isLogin || blockedLoading.value || (!blockedHasNext.value && !opts.reset)) return;

    if (opts.reset) {
      state.value.blockedUsers = [];
      blockedCursor.value = "";
      blockedHasNext.value = true;
    }

    blockedLoading.value = true;
    try {
      const page = await api.getMyBlockedList(blockedCursor.value);
      if (generation !== auth.generation) return;
      state.value.blockedUsers = [...state.value.blockedUsers, ...page.nodes];
      blockedHasNext.value = page.hasNextPage;
      blockedCursor.value = page.endCursor;
      blockedFetchedAt.value = Date.now();
    } catch (err) {
      if (generation !== auth.generation) return;
      message.error(resolveErrorMessage(err, "加载黑名单失败"));
    } finally {
      if (generation === auth.generation) blockedLoading.value = false;
    }
  };

  const ensureSecurity = (force = false) => loadSecurity(force);
  const ensureMihoyo = (force = false) => loadMihoyo(force);
  const ensureBlocked = (force = false) => loadBlocked({ reset: force || isStale(blockedFetchedAt.value) });

  const ensureLoaded = async (force = false) => {
    await Promise.all([
      ensureSecurity(force),
      ensureMihoyo(force),
      ensureBlocked(force),
    ]);
  };

  const unbindMihoyo = async () => {
    const generation = auth.generation;
    if (mihoyoUnbinding.value) return;
    mihoyoUnbinding.value = true;
    try {
      await api.unbindMihoyo();
      if (generation !== auth.generation) return;
      state.value.mihoyoBinding = null;
      mihoyoFetchedAt.value = Date.now();
      message.success("已解除米游社绑定");
    } catch (err) {
      if (generation !== auth.generation) return;
      message.error(resolveErrorMessage(err, "解绑失败"));
    } finally {
      if (generation === auth.generation) mihoyoUnbinding.value = false;
    }
  };

  const setSecurity = (value: AccountSecurity) => {
    state.value.security = value;
    securityFetchedAt.value = Date.now();
  };

  const setPasswordDone = () => {
    if (state.value.security) {
      state.value.security.hasPassword = true;
      state.value.security.provider = "local";
    }
    securityFetchedAt.value = Date.now();
  };

  const unblockUser = async (user: BlockedUser) => {
    const generation = auth.generation;
    if (!user.documentId) return;
    try {
      await api.toggleUserBlock(user.documentId);
      if (generation !== auth.generation) return;
      message.success("已取消拉黑");
      state.value.blockedUsers = state.value.blockedUsers.filter(
        (u) => u.documentId !== user.documentId,
      );
      api.invalidateQueries(["articles"]);
      api.invalidateQueries(["profile"]);
    } catch (err) {
      if (generation !== auth.generation) return;
      message.error(resolveErrorMessage(err, "取消拉黑失败"));
    }
  };

  const setMihoyoBinding = (binding: MihoyoBinding | null) => {
    state.value.mihoyoBinding = binding;
    mihoyoFetchedAt.value = Date.now();
  };

  const fetchSessions = async (force = false) => {
    const generation = auth.generation;
    if (!auth.isLogin || sessionsLoading.value) return;
    if (!force && sessionsFetchedAt.value && !isStale(sessionsFetchedAt.value)) return;

    sessionsLoading.value = true;
    sessionsError.value = "";
    try {
      const result = await api.getMySessions();
      if (generation !== auth.generation) return;
      sessions.value = result;
      sessionsFetchedAt.value = Date.now();
    } catch (err) {
      if (generation !== auth.generation) return;
      sessionsError.value = resolveErrorMessage(err, "获取已登录设备列表失败");
      message.error(sessionsError.value);
    } finally {
      if (generation === auth.generation) sessionsLoading.value = false;
    }
  };

  const ensureSessions = (force = false) => fetchSessions(force);

  const revokeSingleSession = async (id: number): Promise<boolean> => {
    const generation = auth.generation;
    if (sessionsRevoking.value !== null) return false;
    const previous = [...sessions.value];
    const target = previous.find((s) => s.id === id);
    if (!target) return false;

    sessionsRevoking.value = id;
    // 乐观移除
    sessions.value = sessions.value.filter((s) => s.id !== id);

    try {
      await api.revokeSession(id);
      if (generation !== auth.generation) return false;
      message.success("设备已成功下线");
      if (target.isCurrent) {
        await auth.logout();
      }
      return true;
    } catch (err) {
      if (generation !== auth.generation) return false;
      // 失败回滚
      sessions.value = previous;
      message.error(resolveErrorMessage(err, "下线设备失败"));
      return false;
    } finally {
      if (generation === auth.generation) sessionsRevoking.value = null;
    }
  };

  const revokeOtherSessions = async (): Promise<boolean> => {
    const generation = auth.generation;
    if (sessionsRevoking.value !== null) return false;
    const previous = [...sessions.value];

    sessionsRevoking.value = "others";
    // 乐观保留当前设备
    sessions.value = sessions.value.filter((s) => s.isCurrent);

    try {
      await api.revokeOtherSessions();
      if (generation !== auth.generation) return false;
      message.success("其他所有设备已成功下线");
      return true;
    } catch (err) {
      if (generation !== auth.generation) return false;
      // 失败回滚
      sessions.value = previous;
      message.error(resolveErrorMessage(err, "下线其他设备失败"));
      return false;
    } finally {
      if (generation === auth.generation) sessionsRevoking.value = null;
    }
  };

  const clearBlocked = () => {
    state.value.blockedUsers = [];
    blockedCursor.value = "";
    blockedHasNext.value = true;
    blockedFetchedAt.value = null;
  };

  const clear = () => {
    state.value = defaultState();
    securityLoading.value = false;
    mihoyoLoading.value = false;
    blockedLoading.value = false;
    mihoyoUnbinding.value = false;
    securityError.value = "";
    sessionsError.value = "";
    sessions.value = [];
    sessionsFetchedAt.value = null;
    sessionsLoading.value = false;
    sessionsRevoking.value = null;
  };

  if (import.meta.client) {
    window.addEventListener("auth:logout", clear);
  }

  return {
    security,
    securityLoading,
    securityError,
    securityLoaded,
    mihoyoBinding,
    mihoyoLoading,
    mihoyoLoaded,
    mihoyoUnbinding,
    blockedUsers,
    blockedLoading,
    blockedLoaded,
    blockedHasNext,
    sessions,
    sessionsLoading,
    sessionsError,
    sessionsLoaded,
    sessionsRevoking,
    sessionsFetchedAt,

    ensureLoaded,
    ensureSecurity,
    ensureMihoyo,
    ensureBlocked,
    ensureSessions,
    fetchSessions,
    loadSessions: fetchSessions,
    revokeSingleSession,
    revokeSession: revokeSingleSession,
    revokeOtherSessions,
    loadBlocked,
    unbindMihoyo,
    setSecurity,
    setPasswordDone,
    unblockUser,
    setMihoyoBinding,
    clearBlocked,
    clear,
  };
}

export function useAccountData() {
  return _instance ?? (_instance = createAccountData());
}
