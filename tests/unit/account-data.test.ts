import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, reactive, ref } from "vue";
import { useAccountData } from "~/composables/useAccountData";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("zenless-ui", () => ({ useMessage: () => toast }));
const auth = reactive({ generation: 0, isLogin: true, user: { id: 1 }, logout: vi.fn() });
const api = { getMySessions: vi.fn(), getMySecurity: vi.fn(), revokeSession: vi.fn() };
const switchAccount = () => {
  auth.generation++;
  auth.user = { id: 2 };
  window.dispatchEvent(new CustomEvent("auth:logout"));
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("ref", ref);
  vi.stubGlobal("computed", computed);
  vi.stubGlobal("useAuthStore", () => auth);
  vi.stubGlobal("useApi", () => api);
  useAccountData().clear();
});

describe("account data ownership", () => {
  it("discards A's sessions and lets B load while A is pending", async () => {
    let finish!: (rows: unknown[]) => void;
    api.getMySessions.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce([{ id: 2, isCurrent: true }]);
    const data = useAccountData();
    const old = data.ensureSessions();
    switchAccount();
    await data.ensureSessions();
    finish([{ id: 1, isCurrent: true }]);
    await old;
    expect(data.sessions.value.map((s) => s.id)).toEqual([2]);
  });

  it("treats a successful empty response as a cached result", async () => {
    api.getMySessions.mockResolvedValue([]);
    const data = useAccountData();
    await data.ensureSessions();
    await data.ensureSessions();
    expect(api.getMySessions).toHaveBeenCalledOnce();
    expect(data.sessionsLoaded.value).toBe(true);
  });

  it("does not infer password policy when security loading fails", async () => {
    api.getMySecurity.mockRejectedValue(new Error("offline"));
    const data = useAccountData();
    await data.ensureSecurity();
    expect(data.securityLoaded.value).toBe(false);
    expect(data.security.value).toBeNull();
    expect(data.securityError.value).not.toBe("");
  });

  it("keeps failed session loading distinct from an empty list", async () => {
    api.getMySessions.mockRejectedValue(new Error("offline"));
    const data = useAccountData();
    await data.ensureSessions();
    expect(data.sessionsLoaded.value).toBe(false);
    expect(data.sessionsError.value).not.toBe("");
  });

  it("does not restore A's optimistic snapshot over B after a failed revoke", async () => {
    let fail!: (err: Error) => void;
    api.getMySessions.mockResolvedValueOnce([{ id: 1, isCurrent: false }])
      .mockResolvedValueOnce([{ id: 2, isCurrent: true }]);
    api.revokeSession.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const data = useAccountData();
    await data.ensureSessions();
    const pending = data.revokeSingleSession(1);
    switchAccount();
    await data.ensureSessions();
    fail(new Error("offline"));
    expect(await pending).toBe(false);
    expect(data.sessions.value.map((s) => s.id)).toEqual([2]);
  });
});
