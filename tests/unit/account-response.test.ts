import { describe, expect, it } from "vitest";
import { parseAuthSessions, requireAccountSuccess } from "~/utils/account-response";

describe("account API contracts", () => {
  it.each([undefined, null, {}, { success: false }, { success: "true" }])("rejects unconfirmed deletion: %j", (response) => {
    expect(() => requireAccountSuccess(response, "success")).toThrow();
  });
  it("requires explicit revocation success", () => {
    expect(() => requireAccountSuccess({ ok: false }, "ok")).toThrow();
    expect(requireAccountSuccess({ ok: true }, "ok")).toEqual({ ok: true });
  });
  it("distinguishes empty sessions from malformed data", () => {
    expect(parseAuthSessions({ sessions: [] })).toEqual([]);
    expect(() => parseAuthSessions({ data: [] })).toThrow();
    expect(() => parseAuthSessions({ sessions: [{ id: "1" }] })).toThrow();
  });
  it("normalizes nullable and invalid dates", () => {
    expect(parseAuthSessions({ sessions: [{ id: 1, isCurrent: true, userAgent: null, lastSeenAt: "invalid" }] })[0])
      .toMatchObject({ userAgent: null, lastSeenAt: null, createdAt: null });
  });
  it("preserves recorded login details and tolerates older session responses", () => {
    const sessions = parseAuthSessions({ sessions: [
      { id: 1, isCurrent: true, loginMethod: "password", loginAt: "2026-09-18T01:14:00+08:00", location: " 陕西省，西安市 " },
      { id: 2, isCurrent: false, loginMethod: "unsupported", loginAt: "invalid", location: " " },
      { id: 3, isCurrent: false },
    ] });
    expect(sessions[0]).toMatchObject({ loginMethod: "password", loginAt: "2026-09-18T01:14:00+08:00", location: "陕西省，西安市" });
    expect(sessions[1]).toMatchObject({ loginMethod: null, loginAt: null, location: null });
    expect(sessions[2]).toMatchObject({ loginMethod: null, loginAt: null, location: null });
  });
});
