import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, shallowMount, type VueWrapper } from "@vue/test-utils";
import * as Vue from "vue";
import Home from "~/pages/index.vue";
import { useHomeStateCache, type HomeStateSnapshot } from "~/composables/useHomeStateCache";
import { pickFirstQuery } from "~/utils/query";
import type { Post } from "~/types/entities";

const message = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("zenless-ui", () => ({ useMessage: () => message }));
vi.mock("/images/Bangboo.gif", () => ({ default: "/images/Bangboo.gif" }));
vi.mock("@vueuse/core", async () => {
  const { ref } = await import("vue");
  return {
    useDebounceFn: (fn: () => unknown) => fn,
    useWindowSize: () => ({ width: ref(1280) }),
    useMediaQuery: () => ref(false),
  };
});
// Render the slots so assertions observe the posts actually passed to cards.
vi.mock("~/components/VirtualMasonry.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({
    name: "VirtualMasonry",
    props: ["items", "initialHeights"],
    setup: (props, { slots }) => () => h("div", props.items.map((item: Post, index: number) =>
      slots.default?.({ item, index, columnCount: 2 }),
    )),
  }) };
});
vi.mock("~/components/PostCard.vue", () => ({
  default: { name: "PostCard", props: ["post"], emits: ["open"] },
}));
vi.mock("~/components/PostCardSkeleton.vue", () => ({
  default: { name: "PostCardSkeleton", props: ["skeleton"] },
}));

type Page = { nodes: Post[]; endCursor: string; hasNextPage: boolean };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const post = (id: string, isRead = false): Post => ({ id, title: id, covers: [], author: {}, isRead });
const page = (...nodes: Post[]): Page => ({ nodes, endCursor: "next", hasNextPage: true });
const snapshot = (nodes: Post[], feed: HomeStateSnapshot["feed"] = "recommend"): HomeStateSnapshot => ({
  list: nodes, endCursor: "old-cursor", hasNextPage: false, query: "", category: "", feed, sort: "latest",
  seenIds: new Set(nodes.map(({ id }) => id)), measuredHeights: new Map([["post-1", 250]]), scrollY: 400,
});
let wrapper: VueWrapper | undefined;
let intersectionCallbacks: (() => void)[] = [];
const confirmedReadIds = new Set<string>();
const readStatusRevision = Vue.ref(0);
let readStatusEpoch = 0;

const intersectLoadMore = () => {
  expect(intersectionCallbacks.length).toBeGreaterThan(0);
  intersectionCallbacks.at(-1)!();
};

function mountHome(options: { token?: string; cachedPage?: Page; snapshot?: HomeStateSnapshot } = {}) {
  const auth = Vue.reactive({
    token: options.token ?? "", generation: 0,
    get isLogin() { return !!this.token; },
  });
  const requests: ReturnType<typeof deferred<Page>>[] = [];
  let cachedPage = options.cachedPage;
  const readRequest = deferred<void>();
  const api = {
    searchArticles: vi.fn(() => {
      const request = deferred<Page>();
      requests.push(request);
      return request.promise;
    }),
    peekArticles: vi.fn(() => cachedPage),
    clearAllCache: vi.fn(() => {
      readStatusEpoch++;
      cachedPage = undefined;
      if (confirmedReadIds.size) {
        confirmedReadIds.clear();
        readStatusRevision.value++;
      }
    }),
    readStatusRevision,
    mergeReadStatus: (nodes: Post[]) => {
      const merged = nodes.map((node) =>
        confirmedReadIds.has(node.id) && !node.isRead ? { ...node, isRead: true } : node,
      );
      return merged.some((node, i) => node !== nodes[i]) ? merged : nodes;
    },
    invalidateQueries: vi.fn(),
    getCategories: vi.fn(async () => []),
    markAsReadBatch: vi.fn((ids: string[]) => {
      const epoch = readStatusEpoch;
      return readRequest.promise.then(() => {
        if (epoch !== readStatusEpoch) return;
        for (const id of ids) confirmedReadIds.add(id);
        readStatusRevision.value++;
      });
    }),
  };
  const homeCache = useHomeStateCache();
  if (options.snapshot) homeCache.save(options.snapshot);
  const clearSnapshot = vi.spyOn(homeCache, "clear");
  const modal = { isOpen: Vue.ref(false), open: vi.fn(() => { modal.isOpen.value = true; }) };
  const progress = { isActive: Vue.ref(false), start: vi.fn(), claim: vi.fn(), finish: vi.fn() };
  const pendingQueue = Vue.ref<Post[]>([]);
  const pendingPost = {
    queue: pendingQueue,
    peek: vi.fn(() => pendingQueue.value),
    drain: vi.fn(() => pendingQueue.value.splice(0)),
  };
  let leaveRoute: (() => void) | undefined;
  const globals = {
    useApi: () => api,
    useAuthStore: () => auth,
    useHomeStateCache: () => homeCache,
    usePendingPost: () => pendingPost,
    useRoute: () => ({ query: {} }),
    usePostModal: () => modal,
    usePageDataLoading: () => progress,
    useLoginDialog: () => ({ open: vi.fn() }),
    usePresence: () => ({ online: Vue.ref(0), avatars: Vue.ref([]) }),
    useSeoMeta: vi.fn(), onBeforeRouteLeave: (callback: () => void) => { leaveRoute = callback; }, pickFirstQuery,
    ref: Vue.ref, shallowRef: Vue.shallowRef, computed: Vue.computed,
    watch: Vue.watch, nextTick: Vue.nextTick, onMounted: Vue.onMounted, onBeforeUnmount: Vue.onBeforeUnmount,
  };
  for (const [name, value] of Object.entries(globals)) vi.stubGlobal(name, value);
  wrapper = shallowMount(Home, {
    global: { stubs: { ClientOnly: { template: "<slot />" }, VirtualMasonry: false, ZButton: true, ZBacktop: true } },
  });
  const cards = () => wrapper!.findAllComponents({ name: "PostCard" });
  const posts = () => cards().map((card) => card.props("post") as Post);
  const changeIdentity = async (token = "signed-in-token") => {
    // The store/storage-event handler clears caches synchronously, before the
    // page watcher and the new user's profile request run.
    api.clearAllCache();
    auth.token = token;
    auth.generation += 1;
    await Vue.nextTick();
  };
  return {
    auth, api, requests, readRequest, modal, progress, pendingPost, clearSnapshot, cards, posts, changeIdentity,
    leaveRoute: () => leaveRoute!(),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  localStorage.clear();
  confirmedReadIds.clear();
  readStatusRevision.value = 0;
  useHomeStateCache().clear();
  useHomeStateCache().consumeScrollY();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  intersectionCallbacks = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) {
      intersectionCallbacks.push(() => callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      ));
    }
    observe() {}
    disconnect() {}
  });
  message.error.mockReset();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("home feed authentication changes", () => {
  it.each(["success", "failure"] as const)(
    "loads signed-in read status immediately and ignores the late anonymous %s",
    async (outcome) => {
      const home = mountHome();
      expect(home.api.searchArticles).toHaveBeenCalledTimes(1);
      await home.changeIdentity();
      expect(home.api.searchArticles).toHaveBeenCalledTimes(2);
      home.requests[1]!.resolve(page(post("post-1", true)));
      await flushPromises();
      expect(home.posts()).toEqual([post("post-1", true)]);

      if (outcome === "success") home.requests[0]!.resolve(page(post("post-1", false)));
      else home.requests[0]!.reject(new Error("anonymous request failed"));
      await flushPromises();
      expect(home.posts()).toEqual([post("post-1", true)]);
      expect(message.error).not.toHaveBeenCalled();
      expect(home.progress.finish).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["success", "failure"] as const)(
    "keeps the new request loading when the replaced request settles with %s first",
    async (outcome) => {
      const home = mountHome();
      await home.changeIdentity();
      expect(home.api.searchArticles).toHaveBeenCalledTimes(2);
      if (outcome === "success") home.requests[0]!.resolve(page(post("anonymous")));
      else home.requests[0]!.reject(new Error("anonymous request failed"));
      await flushPromises();
      expect(wrapper!.find(".ik-skeleton-state").exists()).toBe(true);
      expect(home.posts()).toEqual([]);
      expect(home.progress.finish).not.toHaveBeenCalled();
      expect(message.error).not.toHaveBeenCalled();

      home.requests[1]!.resolve(page(post("post-1", true)));
      await flushPromises();
      expect(home.posts()).toEqual([post("post-1", true)]);
      expect(home.progress.finish).toHaveBeenCalledTimes(1);
    },
  );

  it("discards an anonymous first-page cache before starting the signed-in request", async () => {
    const home = mountHome({ cachedPage: page(post("post-1")) });
    expect(home.posts()).toEqual([post("post-1")]);
    await home.changeIdentity();
    expect(home.api.clearAllCache).toHaveBeenCalledTimes(1);
    expect(home.posts()).toEqual([]);
    expect(wrapper!.find(".ik-skeleton-state").exists()).toBe(true);
    expect(home.api.searchArticles).toHaveBeenCalledTimes(2);

    home.requests[1]!.resolve(page(post("post-1", true)));
    home.requests[0]!.resolve(page(post("post-1")));
    await flushPromises();
    expect(home.posts()).toEqual([post("post-1", true)]);
  });

  it("clears restored posts and pending read marks when switching accounts", async () => {
    const home = mountHome({ token: "old-user", snapshot: snapshot([post("post-1"), post("post-2", true)]) });
    await flushPromises();
    expect(home.api.searchArticles).not.toHaveBeenCalled();
    home.cards()[0]!.vm.$emit("open", post("post-1"), new MouseEvent("click"));
    await Vue.nextTick();
    expect(home.api.markAsReadBatch).toHaveBeenCalledWith(["post-1"]);

    await home.changeIdentity("new-user");
    expect(home.posts()).toEqual([]);
    expect(home.clearSnapshot).toHaveBeenCalledTimes(2);
    expect(home.api.searchArticles).toHaveBeenCalledExactlyOnceWith("", "", "", "recommend", "latest");
    home.requests[0]!.resolve(page(post("post-1"), post("post-2")));
    await flushPromises();
    home.modal.isOpen.value = false;
    await Vue.nextTick();
    await vi.advanceTimersByTimeAsync(320);
    expect(home.posts()).toEqual([post("post-1"), post("post-2")]);
    expect(wrapper!.findComponent({ name: "VirtualMasonry" }).props("initialHeights")).toBeUndefined();
    home.readRequest.resolve();
  });

  it("does not roll back the new user's read status when an old read request fails", async () => {
    const home = mountHome({ token: "old-user", snapshot: snapshot([post("post-1")]) });
    await flushPromises();
    home.cards()[0]!.vm.$emit("open", post("post-1"), new MouseEvent("click"));
    await home.changeIdentity("new-user");
    home.requests[0]!.resolve(page(post("post-1", true)));
    await flushPromises();
    home.readRequest.reject(new Error("old read request failed"));
    await flushPromises();
    expect(home.posts()).toEqual([post("post-1", true)]);
  });

  it("returns a restored private feed to recommend on logout with one new request", async () => {
    const home = mountHome({ token: "old-user", snapshot: snapshot([post("post-1", true)], "favorites") });
    await flushPromises();
    await home.changeIdentity("");
    expect(home.posts()).toEqual([]);
    expect(home.api.searchArticles).toHaveBeenCalledExactlyOnceWith("", "", "", "recommend", "latest");
    home.requests[0]!.resolve(page(post("post-1")));
    await flushPromises();
    expect(home.posts()).toEqual([post("post-1")]);
    expect(wrapper!.find(".ik-feed-tab--active").exists()).toBe(false);
  });

  it("preserves the feed and its read status during token-only renewal", async () => {
    const home = mountHome({ token: "old-token" });
    home.requests[0]!.resolve(page(post("post-1", true)));
    await flushPromises();
    home.auth.token = "renewed-token";
    await Vue.nextTick();
    expect(home.api.searchArticles).toHaveBeenCalledTimes(1);
    expect(home.api.clearAllCache).not.toHaveBeenCalled();
    expect(home.posts()).toEqual([post("post-1", true)]);
  });

  it("keeps cached first-page revalidation ahead of sentinel pagination", async () => {
    const home = mountHome({ token: "signed-in", cachedPage: page(post("post-1")) });
    await flushPromises();
    expect(home.posts()).toEqual([post("post-1")]);
    intersectLoadMore();
    expect(home.api.searchArticles).toHaveBeenCalledTimes(1);

    home.requests[0]!.resolve(page(post("post-1", true)));
    await flushPromises();
    expect(home.posts()).toEqual([post("post-1", true)]);
    intersectLoadMore();
    expect(home.api.searchArticles).toHaveBeenLastCalledWith("", "next", "", "recommend", "latest");
    home.requests[1]!.resolve(page(post("post-2", true)));
    await flushPromises();
    expect(home.posts()).toEqual([post("post-1", true), post("post-2", true)]);
  });

  it("does not let sentinel pagination supersede an explicit refresh", async () => {
    const home = mountHome({ token: "signed-in" });
    home.requests[0]!.resolve(page(post("post-1")));
    await flushPromises();
    window.dispatchEvent(new Event("ik:home-refresh"));
    await Vue.nextTick();
    expect(home.api.searchArticles).toHaveBeenCalledTimes(2);
    intersectLoadMore();
    expect(home.api.searchArticles).toHaveBeenCalledTimes(2);

    home.requests[1]!.resolve(page(post("post-1", true)));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(600);
    expect(home.posts()).toEqual([post("post-1", true)]);
    intersectLoadMore();
    expect(home.api.searchArticles).toHaveBeenCalledTimes(3);
    home.requests[2]!.resolve(page(post("post-2", true)));
    await flushPromises();
    expect(home.posts()).toEqual([post("post-1", true), post("post-2", true)]);
  });

  it.each(["success", "failure"] as const)(
    "ignores a cold-load %s after unmount without recreating page effects",
    async (outcome) => {
      const home = mountHome({ token: "signed-in" });
      wrapper!.unmount();
      wrapper = undefined;
      // The next page may own the shared loading indicator after this point.
      home.progress.finish.mockClear();
      vi.mocked(window.scrollTo).mockClear();
      if (outcome === "success") home.requests[0]!.resolve(page(post("post-1", true)));
      else home.requests[0]!.reject(new Error("request settled after navigation"));
      await flushPromises();
      expect.soft(window.scrollTo).not.toHaveBeenCalled();
      expect.soft(home.progress.finish).not.toHaveBeenCalled();
      expect.soft(message.error).not.toHaveBeenCalled();
      expect.soft(vi.getTimerCount()).toBe(0);

      // A late mounted continuation must not register a watcher that drains
      // newly published posts for a component that is no longer on screen.
      home.pendingPost.queue.value = [post("new-post")];
      await Vue.nextTick();
      expect(home.pendingPost.drain).not.toHaveBeenCalled();
    },
  );

  it("fetches again after leaving before the first page has loaded", async () => {
    const first = mountHome({ token: "signed-in" });
    first.leaveRoute();
    wrapper!.unmount();
    wrapper = undefined;

    const returned = mountHome({ token: "signed-in" });
    expect(returned.api.searchArticles).toHaveBeenCalledExactlyOnceWith("", "", "", "recommend", "latest");
    returned.requests[0]!.resolve(page(post("post-1", true)));
    first.requests[0]!.resolve(page(post("stale-post")));
    await flushPromises();
    expect(returned.posts()).toEqual([post("post-1", true)]);
  });

  it("preserves a successfully loaded empty feed when returning", async () => {
    const first = mountHome({ token: "signed-in" });
    first.requests[0]!.resolve({ nodes: [], endCursor: "", hasNextPage: false });
    await flushPromises();
    first.leaveRoute();
    wrapper!.unmount();
    wrapper = undefined;

    const returned = mountHome({ token: "signed-in" });
    await flushPromises();
    expect(returned.api.searchArticles).not.toHaveBeenCalled();
    expect(wrapper!.find(".ik-empty").exists()).toBe(true);
  });

  it("retries a failed first page after leaving and returning", async () => {
    const first = mountHome({ token: "signed-in" });
    first.requests[0]!.reject(new Error("temporary list failure"));
    await flushPromises();
    first.leaveRoute();
    wrapper!.unmount();
    wrapper = undefined;

    const returned = mountHome({ token: "signed-in" });
    expect(returned.api.searchArticles).toHaveBeenCalledExactlyOnceWith("", "", "", "recommend", "latest");
    returned.requests[0]!.resolve(page(post("post-1", true)));
    await flushPromises();
    expect(returned.posts()).toEqual([post("post-1", true)]);
  });

  it.each(["before", "after"] as const)("retains a read confirmed %s returning from another page", async (timing) => {
    const first = mountHome({ token: "signed-in", snapshot: snapshot([post("post-1")]) });
    await flushPromises();
    first.cards()[0]!.vm.$emit("open", post("post-1"), new MouseEvent("click"));
    first.leaveRoute();
    wrapper!.unmount();
    wrapper = undefined;
    if (timing === "before") {
      first.readRequest.resolve();
      await flushPromises();
    }

    const returned = mountHome({ token: "signed-in" });
    await flushPromises();
    expect(returned.api.searchArticles).not.toHaveBeenCalled();
    expect(returned.posts()).toEqual([post("post-1", timing === "before")]);
    if (timing === "after") {
      first.readRequest.resolve();
      await flushPromises();
    }
    expect(returned.posts()).toEqual([post("post-1", true)]);
  });

  it("does not persist an unconfirmed optimistic read across navigation", async () => {
    const first = mountHome({ token: "signed-in", snapshot: snapshot([post("post-1")]) });
    await flushPromises();
    first.cards()[0]!.vm.$emit("open", post("post-1"), new MouseEvent("click"));
    await Vue.nextTick();
    first.modal.isOpen.value = false;
    await Vue.nextTick();
    await vi.advanceTimersByTimeAsync(320);
    expect(first.posts()).toEqual([post("post-1", true)]);
    first.leaveRoute();
    wrapper!.unmount();
    wrapper = undefined;

    const returned = mountHome({ token: "signed-in" });
    await flushPromises();
    expect(returned.posts()).toEqual([post("post-1")]);
    first.readRequest.reject(new Error("read was not saved"));
    await flushPromises();
    expect(returned.posts()).toEqual([post("post-1")]);
    expect(message.error).not.toHaveBeenCalled();
  });
});
