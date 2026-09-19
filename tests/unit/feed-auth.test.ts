import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient } from "@tanstack/vue-query";
import type { $Fetch } from "ofetch";
import { useApi } from "~/composables/useApi";
import { useHomeStateCache } from "~/composables/useHomeStateCache";
import { _resetHydratedForTest, useAuthStore } from "~/stores/auth";
import { LOGOUT_KEY, SESSION_HINT_KEY } from "~/utils/auth-session";

const transport = vi.hoisted(() => vi.fn());
vi.mock("ofetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ofetch")>();
  // Only replace the network. Keep ofetch hooks, response parsing, the API
  // plugin's 401 retry, and the store's renewal path running their real code.
  return { ...actual, $fetch: actual.createFetch({ fetch: transport }) };
});

type RequestRecord = { path: string; authorization: string | null };
const requests: RequestRecord[] = [];
let queryClient: QueryClient;
let backend: (request: RequestRecord) => Response | Promise<Response>;
let profileResponse: () => Response | Promise<Response>;
let storageListener: ((event: StorageEvent) => void) | undefined;
let onlineListener: (() => void) | undefined;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function jwt(expiresInSeconds: number, id = 1, sid = "session-1") {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `header.${btoa(JSON.stringify({ id, sid, exp }))}.signature`;
}

function articles(isRead: boolean) {
  return json({
    data: [{ documentId: "already-read", title: "Read on a previous visit", isRead }],
    meta: { pagination: { start: 0, limit: 20, total: 1, pageCount: 1 } },
  });
}

const feeds = [
  { query: "", endpoint: "/api/articles/list" },
  { query: "委托", endpoint: "/api/articles/search" },
];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
  setActivePinia(createPinia());
  _resetHydratedForTest();
  localStorage.clear();
  useHomeStateCache().reset();
  storageListener = undefined;
  onlineListener = undefined;
  profileResponse = () => json({ id: 1, documentId: "reader", name: "Reader" });
  requests.length = 0;
  transport.mockReset();
  transport.mockImplementation(async (input: string, options?: RequestInit) => {
    const request = {
      path: new URL(input).pathname,
      authorization: new Headers(options?.headers).get("Authorization"),
    };
    requests.push(request);
    if (request.path === "/api/me/profile") return profileResponse();
    return backend(request);
  });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  vi.stubGlobal("useRuntimeConfig", () => ({ public: { apiBaseUrl: "https://api.example.test" } }));
  vi.stubGlobal("useAuthStore", useAuthStore);
  vi.stubGlobal("useApi", useApi);
  vi.stubGlobal("defineNuxtPlugin", (setup: unknown) => setup);
  const setup = (await import("~/plugins/api")).default as unknown as () => { provide: { api: $Fetch } };
  // Plugin listeners belong to an app lifetime. Avoid retaining old stores
  // across test cases; the request and renewal behavior is tested below.
  const listeners = vi.spyOn(window, "addEventListener").mockImplementation((type, listener) => {
    if (type === "storage") storageListener = listener as (event: StorageEvent) => void;
    if (type === "online") onlineListener = listener as () => void;
  });
  const { provide } = setup();
  listeners.mockRestore();
  vi.stubGlobal("useNuxtApp", () => ({ $api: provide.api, $queryClient: queryClient }));
  useApi().clearAllCache();
});

afterEach(() => {
  queryClient.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("cross-tab authentication", () => {
  it("preserves profile, cached read state and in-flight requests during the same session's token rotation", async () => {
    const oldToken = jwt(600), newToken = jwt(900);
    localStorage.setItem("access_token", oldToken);
    backend = () => articles(true);
    const auth = useAuthStore();
    await auth.hydrateFromStorage();
    const cached = await useApi().searchArticles("");
    const pendingResponse = deferred<Response>();
    backend = () => pendingResponse.promise;
    const pending = useApi().searchArticles("another query");
    await vi.waitFor(() => expect(requests.some(({ path }) => path === "/api/articles/search")).toBe(true));
    const generation = auth.generation;
    const user = auth.user;
    const dispatch = vi.spyOn(window, "dispatchEvent");
    localStorage.setItem("access_token", newToken);
    storageListener!(new StorageEvent("storage", { key: "access_token", oldValue: oldToken, newValue: newToken }));
    const afterRotation = { generation: auth.generation, user: auth.user, cached: useApi().peekArticles(""),
      logoutEvents: dispatch.mock.calls.filter(([event]) => event.type === "auth:logout").length };
    // Settle the request even in the regressed implementation that cancels its query.
    const outcome = pending.then((page) => page.nodes[0]?.isRead, () => false);
    pendingResponse.resolve(articles(true));
    expect(await outcome).toBe(true);
    expect(afterRotation).toEqual({ generation, user, cached, logoutEvents: 0 });
    expect(auth.token).toBe(newToken);
  });

  it.each([jwt(900, 2), jwt(900, 1, "another-session"), "opaque-token"])(
    "invalidates personalized queries when the new token does not prove the same session: %s",
    async (newToken) => {
      const oldToken = jwt(600);
      localStorage.setItem("access_token", oldToken);
      backend = () => articles(true);
      const auth = useAuthStore();
      await auth.hydrateFromStorage();
      await useApi().searchArticles("");
      const generation = auth.generation;
      localStorage.setItem("access_token", newToken);
      storageListener!(new StorageEvent("storage", { key: "access_token", oldValue: oldToken, newValue: newToken }));
      expect(auth.generation).toBe(generation + 1);
      expect(useApi().peekArticles("")).toBeUndefined();
      await vi.waitFor(() => expect(auth.user?.id).toBe(1));
    },
  );

  it("uses the latest shared token when old storage events are queued", async () => {
    const oldToken = jwt(600), newToken = jwt(900);
    localStorage.setItem("access_token", oldToken);
    backend = () => articles(true);
    const auth = useAuthStore();
    await auth.hydrateFromStorage();
    await useApi().searchArticles("");
    const generation = auth.generation;
    localStorage.setItem("access_token", newToken);
    storageListener!(new StorageEvent("storage", { key: "access_token", oldValue: oldToken, newValue: null }));
    expect(auth.token).toBe(newToken);
    expect(auth.generation).toBe(generation);
    expect(useApi().peekArticles("")?.nodes[0]?.isRead).toBe(true);
  });

  it("clears anonymous queries and the home snapshot before loading the new user's profile", async () => {
    const token = jwt(600);
    backend = ({ authorization }) => articles(authorization === `Bearer ${token}`);
    const anonymousPage = await useApi().searchArticles("");
    const homeCache = useHomeStateCache();
    homeCache.save({
      list: anonymousPage.nodes,
      endCursor: anonymousPage.endCursor,
      hasNextPage: anonymousPage.hasNextPage,
      query: "", category: "", feed: "recommend", sort: "latest",
      seenIds: new Set(anonymousPage.nodes.map(({ id }) => id)),
      measuredHeights: new Map([["already-read", 250]]), scrollY: 400,
    });
    expect(queryClient.getQueryCache().findAll({ queryKey: ["articles", "search"] })).toHaveLength(1);
    const profile = deferred<Response>();
    profileResponse = () => profile.promise;
    const auth = useAuthStore();
    const fetchSelf = vi.spyOn(auth, "fetchSelfUser");

    // Browsers update shared localStorage before delivering the other tab's
    // storage event. Invoke the exact callback registered by the real plugin.
    localStorage.setItem("access_token", token);
    expect(storageListener).toBeDefined();
    storageListener!(new StorageEvent("storage", { key: "access_token", oldValue: null, newValue: token }));
    expect(fetchSelf).toHaveBeenCalledOnce();
    const selfLoading = fetchSelf.mock.results[0]!.value as Promise<void>;
    expect(queryClient.getQueryCache().findAll({ queryKey: ["articles", "search"] })).toHaveLength(0);
    expect(homeCache.restore()).toBeNull();
    expect(homeCache.consumeScrollY()).toBe(0);
    expect(queryClient.getQueryState(["me", "self"])?.fetchStatus).toBe("fetching");

    profile.resolve(json({ id: 2, documentId: "new-reader", name: "New reader" }));
    await selfLoading;
    expect(auth.user?.id).toBe(2);
    expect(queryClient.getQueryState(["me", "self"])?.status).toBe("success");
    expect((await useApi().searchArticles("")).nodes[0]?.isRead).toBe(true);
    expect(requests).toEqual([
      { path: "/api/articles/list", authorization: null },
      { path: "/api/me/profile", authorization: `Bearer ${token}` },
      { path: "/api/articles/list", authorization: `Bearer ${token}` },
    ]);
  });
});

describe.each(feeds)("first $endpoint request", ({ query, endpoint }) => {
  it("loads the feed without waiting for a slow profile while full hydration still waits", async () => {
    localStorage.setItem("access_token", jwt(600));
    const profile = deferred<Response>();
    profileResponse = () => profile.promise;
    backend = () => articles(true);
    let hydrated = false;
    const hydration = useAuthStore().hydrateFromStorage().then(() => { hydrated = true; });
    const loading = useApi().searchArticles(query);
    await vi.waitFor(() => expect(requests.some(({ path }) => path === "/api/me/profile")).toBe(true));
    await vi.advanceTimersByTimeAsync(0);
    const duringProfile = { feedRequests: requests.filter(({ path }) => path === endpoint).length, hydrated };
    profile.resolve(json({ id: 1, documentId: "reader" }));
    const [, page] = await Promise.all([hydration, loading]);
    expect(duringProfile).toEqual({ feedRequests: 1, hydrated: false });
    expect(page.nodes[0]?.isRead).toBe(true);
  });

  it("serves an anonymous feed while a persisted logout is still being revoked", async () => {
    localStorage.setItem(LOGOUT_KEY, "pending");
    const logout = deferred<Response>();
    backend = ({ path }) => path === "/api/auth/session/logout" ? logout.promise : articles(false);
    const hydration = useAuthStore().hydrateFromStorage();
    const loading = useApi().searchArticles(query);
    await vi.waitFor(() => expect(requests.some(({ path }) => path === "/api/auth/session/logout")).toBe(true));
    await vi.advanceTimersByTimeAsync(0);
    const feedRequests = requests.filter(({ path }) => path === endpoint);
    logout.resolve(json({ ok: true }));
    await Promise.all([hydration, loading]);
    expect(feedRequests).toEqual([{ path: endpoint, authorization: null }]);
  });

  it.each(["next request", "online", "timer"])("recovers transient cookie failure on %s and discards anonymous cache", async (trigger) => {
    localStorage.setItem(SESSION_HINT_KEY, "1");
    const token = jwt(600);
    let recovered = false;
    backend = ({ path, authorization }) => path === "/api/auth/session/refresh"
      ? (recovered ? json({ accessToken: token }) : json({ error: { message: "Temporarily unavailable" } }, 503))
      : articles(authorization === `Bearer ${token}`);
    const auth = useAuthStore();
    await auth.hydrateFromStorage();
    expect((await useApi().searchArticles(query)).nodes[0]?.isRead).toBe(false);
    const generation = auth.generation;
    recovered = true;
    if (trigger === "online") onlineListener!();
    if (trigger === "timer") await vi.advanceTimersByTimeAsync(5000);
    if (trigger !== "next request") await vi.waitFor(() => expect(auth.isLogin).toBe(true));
    const page = await useApi().searchArticles(query);
    expect(page.nodes[0]?.isRead).toBe(true);
    expect(auth.generation).toBe(generation + 1);
    expect(requests.filter(({ path }) => path === endpoint)).toHaveLength(2);
  });

  it.each([-30, 60])("renews a post-sleep token with %i seconds left before sending the feed request", async (expiresInSeconds) => {
    const expired = jwt(expiresInSeconds), renewed = jwt(600);
    localStorage.setItem("access_token", jwt(600));
    backend = () => articles(true);
    const auth = useAuthStore();
    await auth.hydrateFromStorage();
    const generation = auth.generation;
    // Background timers did not run while the tab slept. The backend's optional
    // auth middleware treats an expired bearer as anonymous and still returns 200.
    auth.token = expired;
    localStorage.setItem("access_token", expired);
    requests.length = 0;
    backend = ({ path, authorization }) => path === "/api/auth/session/refresh"
      ? json({ accessToken: renewed }) : articles(authorization === `Bearer ${renewed}`);
    expect((await useApi().searchArticles(query)).nodes[0]?.isRead).toBe(true);
    expect(requests.filter(({ path }) => path === endpoint)).toEqual([
      { path: endpoint, authorization: `Bearer ${renewed}` },
    ]);
    expect(auth.generation).toBe(generation);
  });

  it("rejects a failed expired-token recovery without caching an anonymous 200, then refreshes on recovery", async () => {
    localStorage.setItem("access_token", jwt(600));
    backend = () => articles(true);
    const auth = useAuthStore();
    await auth.hydrateFromStorage();
    await useApi().searchArticles(query);
    const expired = jwt(-30), renewed = jwt(600);
    auth.token = expired;
    localStorage.setItem("access_token", expired);
    let recovered = false;
    backend = ({ path, authorization }) => path === "/api/auth/session/refresh"
      ? (recovered ? json({ accessToken: renewed }) : json({ error: { message: "Temporarily unavailable" } }, 503))
      : articles(authorization === `Bearer ${renewed}`);
    const generation = auth.generation;
    await expect(useApi().searchArticles(query)).rejects.toThrow();
    expect(requests.filter(({ path }) => path === endpoint)).toHaveLength(1);
    expect(useApi().peekArticles(query)?.nodes[0]?.isRead).toBe(true);
    recovered = true;
    onlineListener!();
    await vi.waitFor(() => expect(auth.token).toBe(renewed));
    expect(auth.generation).toBe(generation + 1);
    expect((await useApi().searchArticles(query)).nodes[0]?.isRead).toBe(true);
  });

  it.each(["cookie only", "expired access token"])("waits for delayed %s recovery before fetching or caching unread data", async (session) => {
    localStorage.setItem(SESSION_HINT_KEY, "1");
    if (session === "expired access token") localStorage.setItem("access_token", jwt(-60));
    const refreshedToken = jwt(600);
    const refresh = deferred<Response>();
    backend = ({ path, authorization }) => path === "/api/auth/session/refresh"
      ? refresh.promise
      : articles(authorization === `Bearer ${refreshedToken}`);

    const auth = useAuthStore();
    const hydration = auth.hydrateFromStorage();
    const loading = useApi().searchArticles(query);
    await vi.waitFor(() => expect(requests.some(({ path }) => path === "/api/auth/session/refresh")).toBe(true));
    const requestsDuringRecovery = [...requests];
    const cachedDuringRecovery = queryClient.getQueryCache().findAll({ queryKey: ["articles", "search"] }).length;
    // Always settle the cookie operation before assertions, including when a
    // regression is present, so the shared cookie queue cannot leak into tests.
    refresh.resolve(json({ accessToken: refreshedToken }));
    const [, page] = await Promise.all([hydration, loading]);

    expect(requestsDuringRecovery.filter(({ path }) => path === endpoint)).toEqual([]);
    expect(cachedDuringRecovery).toBe(0);
    expect(page.nodes[0]?.isRead).toBe(true);
    expect(requests.filter(({ path }) => path === endpoint)).toEqual([
      { path: endpoint, authorization: `Bearer ${refreshedToken}` },
    ]);
    expect(requests.filter(({ path }) => path === "/api/auth/session/refresh")).toHaveLength(1);
    // A second visit within staleTime must retain the personalized first page.
    expect((await useApi().searchArticles(query)).nodes[0]?.isRead).toBe(true);
    expect(requests.filter(({ path }) => path === endpoint)).toHaveLength(1);
  });

  it("serves an anonymous visitor without a refresh or profile request", async () => {
    backend = () => articles(false);
    const page = await useApi().searchArticles(query);

    expect(page.nodes[0]?.isRead).toBe(false);
    onlineListener!();
    await vi.advanceTimersByTimeAsync(65000);
    await useApi().searchArticles(query);
    expect(requests).toEqual([{ path: endpoint, authorization: null }]);
    expect(useAuthStore().isLogin).toBe(false);
  });

  it("renews a rejected token and retries with personalized read status", async () => {
    const oldToken = jwt(600);
    const newToken = jwt(900);
    localStorage.setItem("access_token", oldToken);
    backend = ({ path, authorization }) => {
      if (path === "/api/auth/session/refresh") return json({ accessToken: newToken });
      if (authorization === `Bearer ${oldToken}`) {
        return json({ error: { message: "Token rejected", code: "UNAUTHORIZED" } }, 401);
      }
      return articles(authorization === `Bearer ${newToken}`);
    };

    // Isolate 401 handling from initial hydration: the store already holds the
    // token, but the backend has rejected it before its local expiry time.
    await useAuthStore().hydrateFromStorage();
    const page = await useApi().searchArticles(query);

    expect(page.nodes[0]?.isRead).toBe(true);
    expect(requests.filter(({ path }) => path === endpoint)).toEqual([
      { path: endpoint, authorization: `Bearer ${oldToken}` },
      { path: endpoint, authorization: `Bearer ${newToken}` },
    ]);
    expect(requests.filter(({ path }) => path === "/api/auth/session/refresh")).toHaveLength(1);
    expect(useAuthStore().token).toBe(newToken);
  });
});
