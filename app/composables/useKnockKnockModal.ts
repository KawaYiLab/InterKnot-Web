/** 敲敲浮层：用 RouterHistory 更新地址，保留背景页，支持直达和前进/后退。 */
import { ref } from "vue";
import { cancelPendingModalNavigation, restoreModalBackground } from "~/utils/post-modal-history";
import {
  knockHistoryUrl, readKnockTarget, readLocationUrl, serializeHistoryUrl,
  type KnockTab, type KnockTarget,
} from "~/utils/overlay-history";

const knockKnockVisible = ref(false);
const pendingDmConversationId = ref<string | null>(null);
const pendingKnockTab = ref<KnockTab | null>(null);
const requestId = ref(0);
const SCROLL_LOCK_TOKEN = Symbol("knock-knock-modal");
const DEFAULT_TITLE = "绳网";

interface Background {
  key: string;
  url: string;
  route: string;
  position: unknown;
  title: string;
  target: KnockTarget;
}
const backgrounds = new Map<string, Background>();
let activeKey: string | null = null;
let historyPushed = false;
let closing = false;
let queuedOpen: (() => void) | null = null;
let savedTitle = "";

type OpenOptions = Partial<KnockTarget>;

export function useKnockKnockModal() {
  const router = useRouter();
  const { acquire, release } = useBodyScrollLock();
  let resumeRouter: (() => void) | null = null;

  function show(background: Background) {
    if (!knockKnockVisible.value) {
      savedTitle = background.title;
      acquire(SCROLL_LOCK_TOKEN);
    }
    activeKey = background.key;
    historyPushed = true;
    pendingKnockTab.value = background.target.tab;
    pendingDmConversationId.value = background.target.dmConversationId ?? null;
    knockKnockVisible.value = true;
    requestId.value++;
    document.title = `敲敲 - ${DEFAULT_TITLE}`;
  }

  function open(options?: OpenOptions) {
    if (!import.meta.client) return;
    if (closing) {
      queuedOpen = () => open(options);
      return;
    }
    const target: KnockTarget = { tab: options?.tab ?? "contacts", dmConversationId: options?.dmConversationId };
    let background = activeKey ? backgrounds.get(activeKey) : undefined;
    const replacing = knockKnockVisible.value && !!background;
    if (!replacing) {
      background = {
        key: crypto.randomUUID(),
        url: serializeHistoryUrl(readLocationUrl()),
        route: router.currentRoute.value.fullPath,
        position: window.history.state?.position,
        title: document.title,
        target,
      };
      backgrounds.set(background.key, background);
    }
    background!.target = target;
    const currentState = window.history.state;
    const state = {
      __knockKnockModal: true, knockModalKey: background!.key,
      modalBackgroundRoute: background!.route,
      modalBackgroundPosition: currentState?.modalBackgroundRoute === background!.route
        ? currentState.modalBackgroundPosition : background!.position,
    };
    const url = knockHistoryUrl(target.tab, target.dmConversationId);
    if (replacing) router.options.history.replace(url, state);
    else router.options.history.push(url, state);
    show(background!);
  }

  /** 先建立可关闭返回的背景项，再恢复目标；刷新不依赖旧标签页的内存状态。 */
  async function openFromUrl(url = readLocationUrl()) {
    const target = readKnockTarget(url);
    if (!target) return;
    const failure = await router.replace("/");
    if (!failure) open(target);
  }

  function close() {
    if (!knockKnockVisible.value || closing) return;
    if (historyPushed && window.history.state?.knockModalKey === activeKey) {
      closing = true;
      window.history.back();
    } else {
      teardown();
    }
  }

  function teardown() {
    closing = false;
    activeKey = null;
    historyPushed = false;
    if (!knockKnockVisible.value) return;
    knockKnockVisible.value = false;
    release(SCROLL_LOCK_TOKEN);
    pendingDmConversationId.value = null;
    pendingKnockTab.value = null;
    if (import.meta.client) document.title = savedTitle || DEFAULT_TITLE;
  }

  // 与帖子浮层一样，让 RouterHistory 同步位置，但暂停本轮整页导航。
  function keepBackgroundRoute() {
    if (!router.listening) return;
    cancelPendingModalNavigation(router);
    router.listening = false;
    const resume = () => {
      if (resumeRouter !== resume) return;
      router.listening = true;
      resumeRouter = null;
    };
    resumeRouter = resume;
    setTimeout(resume, 0);
  }

  function handlePopState() {
    resumeRouter?.();
    const state = window.history.state;
    const active = activeKey ? backgrounds.get(activeKey) : undefined;
    const url = readLocationUrl();
    if (active && serializeHistoryUrl(url) === active.url && state?.position === active.position &&
        router.currentRoute.value.fullPath === active.route) {
      keepBackgroundRoute();
      const reopen = queuedOpen;
      queuedOpen = null;
      teardown();
      if (reopen) setTimeout(reopen, 0);
      return;
    }
    const background = state?.__knockKnockModal ? backgrounds.get(state.knockModalKey) : undefined;
    if (background && router.currentRoute.value.fullPath === background.route) {
      const isKnock = !!readKnockTarget(url);
      if (isKnock) keepBackgroundRoute();
      closing = false;
      // 帖子可以叠在敲敲上面；返回敲敲时保留当前消息和滚动位置。
      if (!knockKnockVisible.value || activeKey !== background.key) {
        const title = document.title;
        show(background);
        if (!isKnock) document.title = title;
      }
      return;
    }
    queuedOpen = null;
    teardown();
    if (background) restoreModalBackground(router, background.route, background.position);
  }

  function updateUrl(tab: KnockTab, conversationId?: string | null) {
    if (!import.meta.client || !knockKnockVisible.value) return;
    const background = activeKey ? backgrounds.get(activeKey) : undefined;
    if (!background) return;
    background.target = { tab, dmConversationId: conversationId ?? undefined };
    // 初始化请求可能在打开上层帖子之后才完成，此时不能覆盖帖子地址。
    if (window.history.state?.__postModal) return;
    router.options.history.replace(knockHistoryUrl(tab, conversationId), {
      __knockKnockModal: true, knockModalKey: background.key,
    });
  }

  const consumePendingDmConversationId = () => {
    const next = pendingDmConversationId.value;
    pendingDmConversationId.value = null;
    return next;
  };
  const consumePendingKnockTab = () => {
    const next = pendingKnockTab.value;
    pendingKnockTab.value = null;
    return next;
  };

  return {
    visible: knockKnockVisible, pendingDmConversationId, requestId,
    open, openFromUrl, close, handlePopState, teardown, updateUrl,
    consumePendingDmConversationId, consumePendingKnockTab,
  };
}
