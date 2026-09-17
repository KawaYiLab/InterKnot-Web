import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useAuthStore, _resetHydratedForTest } from "~/stores/auth";
import { LOGOUT_KEY, SESSION_HINT_KEY } from "~/utils/auth-session";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), self: vi.fn(), clear: vi.fn() }));
vi.mock("ofetch", () => ({ $fetch: mocks.fetch }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function jwt(expSeconds: number) {
  return `header.${btoa(JSON.stringify({ exp: expSeconds }))}.signature`;
}

beforeEach(() => {
  setActivePinia(createPinia());
  _resetHydratedForTest();
  localStorage.clear();
  vi.resetAllMocks();
  vi.stubGlobal("useRuntimeConfig", () => ({ public: { apiBaseUrl: "https://api.example.test" } }));
  vi.stubGlobal("useApi", () => ({ getSelfUser: mocks.self, clearAllCache: mocks.clear }));
});

describe("authentication lifecycle", () => {
  it("keeps a fresh anonymous visitor ready without refreshing, including after reload", async () => {
    for (let visit = 0; visit < 2; visit += 1) {
      setActivePinia(createPinia());
      const auth = useAuthStore();
      await auth.hydrateFromStorage();
      expect(auth.isLogin).toBe(false);
      expect(auth.hydrationReady).toBe(true);
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.self).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it("does not try to renew a session for an anonymous visitor", async () => {
    expect(await useAuthStore().renewToken()).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("restores an existing valid access token without refreshing", async () => {
    const token = jwt(Math.floor(Date.now() / 1000) + 600);
    localStorage.setItem("access_token", token);
    mocks.self.mockResolvedValue({ id: 1 });
    const auth = useAuthStore();
    await auth.hydrateFromStorage();
    expect(auth.token).toBe(token);
    expect(auth.user?.id).toBe(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBe("1");
  });

  it("renews an expired access token using the refresh cookie", async () => {
    localStorage.setItem("access_token", jwt(Math.floor(Date.now() / 1000) - 60));
    mocks.fetch.mockResolvedValue({ accessToken: "restored" });
    mocks.self.mockResolvedValue({ id: 1 });
    const auth = useAuthStore();
    await auth.hydrateFromStorage();
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith("/api/auth/session/refresh", {
      baseURL: "https://api.example.test", method: "POST", credentials: "include", retry: 0,
    });
    expect(auth.token).toBe("restored");
    expect(auth.user?.id).toBe(1);
    expect(localStorage.getItem("access_token")).toBe("restored");
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBe("1");
    expect(auth.hydrationReady).toBe(true);
  });

  it("stops refreshing on subsequent visits after the refresh token is rejected", async () => {
    localStorage.setItem("access_token", jwt(Math.floor(Date.now() / 1000) - 60));
    localStorage.setItem(SESSION_HINT_KEY, "1");
    mocks.fetch.mockRejectedValue({ statusCode: 401 });
    await useAuthStore().hydrateFromStorage();
    expect(localStorage.getItem("access_token")).toBeNull();
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
    setActivePinia(createPinia());
    const auth = useAuthStore();
    await auth.hydrateFromStorage();
    expect(auth.isLogin).toBe(false);
    expect(auth.hydrationReady).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it("preserves cookie recovery after a transient network failure", async () => {
    localStorage.setItem(SESSION_HINT_KEY, "1");
    mocks.fetch.mockRejectedValueOnce(new Error("offline"));
    const auth = useAuthStore();
    await auth.hydrateFromStorage();
    expect(auth.isLogin).toBe(false);
    expect(auth.hydrationReady).toBe(true);
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBe("1");
    mocks.fetch.mockResolvedValueOnce({ accessToken: "restored" });
    mocks.self.mockResolvedValue({ id: 1 });
    setActivePinia(createPinia());
    const reloaded = useAuthStore();
    await reloaded.hydrateFromStorage();
    expect(reloaded.token).toBe("restored");
    expect(reloaded.user?.id).toBe(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("gives explicit logout priority over any remaining recovery hint", async () => {
    localStorage.setItem(SESSION_HINT_KEY, "1");
    localStorage.setItem(LOGOUT_KEY, "1");
    const auth = useAuthStore();
    await auth.hydrateFromStorage();
    expect(await auth.renewToken()).toBeNull();
    expect(auth.isLogin).toBe(false);
    expect(auth.hydrationReady).toBe(true);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not restore A when its refresh finishes after login to B", async () => {
    localStorage.setItem(SESSION_HINT_KEY, "1");
    const pending = deferred<{ accessToken: string }>();
    mocks.fetch.mockReturnValue(pending.promise);
    const auth = useAuthStore();
    const hydration = auth.hydrateFromStorage();
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    auth.setSession("token-b", { id: 2, name: "B" });
    pending.resolve({ accessToken: "token-a" });
    await hydration;
    expect(auth.token).toBe("token-b");
    expect(auth.user?.id).toBe(2);
    expect(localStorage.getItem("access_token")).toBe("token-b");
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBe("1");
    expect(auth.hydrationReady).toBe(true);
  });

  it("does not clear B when A's self request fails", async () => {
    const pending = deferred<never>();
    mocks.self.mockReturnValue(pending.promise);
    const auth = useAuthStore();
    auth.setSession("a", { id: 1 });
    const loading = auth.fetchSelfUser();
    auth.setSession("b", { id: 2 });
    pending.reject({ statusCode: 401 });
    await loading;
    expect(auth.token).toBe("b");
  });

  it("ignores A's successful self response after switching to B", async () => {
    const pending = deferred<{ id: number }>();
    mocks.self.mockReturnValue(pending.promise);
    const auth = useAuthStore();
    auth.setSession("a", { id: 1 });
    const loading = auth.fetchSelfUser();
    auth.setSession("b", { id: 2 });
    pending.resolve({ id: 1 });
    await loading;
    expect(auth.user?.id).toBe(2);
  });

  it("invalidates refresh immediately and queues logout after the cookie response", async () => {
    const pending = deferred<{ accessToken: string }>();
    mocks.fetch.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ok: true });
    const auth = useAuthStore();
    auth.setSession("a", { id: 1 });
    const renewal = auth.renewToken();
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    const logout = auth.logout();
    expect(auth.isLogin).toBe(false);
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    pending.resolve({ accessToken: "late-a" });
    await Promise.all([renewal, logout]);
    expect(auth.isLogin).toBe(false);
    expect(mocks.fetch.mock.calls[1]?.[0]).toBe("/api/auth/session/logout");
  });

  it("failed logout suppresses cookie hydration on reload and retries revocation", async () => {
    mocks.fetch.mockRejectedValue(new Error("offline"));
    const auth = useAuthStore();
    auth.setSession("a", { id: 1 });
    expect(await auth.logout()).toBe(false);
    expect(localStorage.getItem(LOGOUT_KEY)).toBe("pending");
    setActivePinia(createPinia());
    await useAuthStore().hydrateFromStorage();
    expect(mocks.fetch.mock.calls.every(([path]) => path === "/api/auth/session/logout")).toBe(true);
    expect(useAuthStore().isLogin).toBe(false);
  });

  it("shares hydration and keeps readiness false until cookie recovery finishes", async () => {
    useAuthStore().setSession("previous", { id: 1 });
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBe("1");
    localStorage.removeItem("access_token");
    setActivePinia(createPinia());
    const pending = deferred<{ accessToken: string }>();
    mocks.fetch.mockReturnValue(pending.promise);
    mocks.self.mockResolvedValue({ id: 1 });
    const auth = useAuthStore();
    const first = auth.hydrateFromStorage();
    const second = auth.hydrateFromStorage();
    expect(auth.hydrationReady).toBe(false);
    pending.resolve({ accessToken: "restored" });
    await Promise.all([first, second]);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(auth.isLogin).toBe(true);
    expect(auth.hydrationReady).toBe(true);
  });
});
