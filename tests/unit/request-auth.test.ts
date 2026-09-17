import { describe, expect, it } from "vitest";
import {
  decodeJwtExp,
  isPublicEndpoint,
  isTokenExpired,
  isTokenNearExpiry,
  shouldAttachToken,
} from "~/utils/request-auth";

function createMockJwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ id: 1, exp: expSeconds })).toString("base64url");
  return `${header}.${payload}.signature`;
}

describe("request-auth endpoint classification", () => {
  it("classifies standard auth login/register endpoints as public", () => {
    expect(isPublicEndpoint("/api/auth/local", "POST")).toBe(true);
    expect(isPublicEndpoint("/api/auth/send-register-code", "POST")).toBe(true);
    expect(isPublicEndpoint("/api/auth/register-with-code", "POST")).toBe(true);
  });

  it("classifies sessions and renew endpoints as non-public", () => {
    expect(isPublicEndpoint("/api/auth/sessions", "GET")).toBe(false);
    expect(isPublicEndpoint("/api/auth/sessions/1", "DELETE")).toBe(false);
    expect(isPublicEndpoint("/api/auth/renew", "POST")).toBe(false);
    expect(isPublicEndpoint("/api/auth/mihoyo/binding", "GET")).toBe(false);
  });

  it("correctly determines whether to attach token", () => {
    const token = "mock-jwt-token";
    // Public endpoint without exception -> should not attach
    expect(shouldAttachToken("/api/auth/local", "POST", token)).toBe(false);
    // Protected endpoint -> should attach
    expect(shouldAttachToken("/api/auth/sessions", "GET", token)).toBe(true);
    expect(shouldAttachToken("/api/auth/sessions/2", "DELETE", token)).toBe(true);
    // Whitelisted GET endpoints that require user personalization
    expect(shouldAttachToken("/api/authors/search?q=test", "GET", token)).toBe(true);
    expect(shouldAttachToken("/api/articles/detail/123", "GET", token)).toBe(true);
    // When no token is present, should never attach
    expect(shouldAttachToken("/api/auth/sessions", "GET", "")).toBe(false);
  });
});

describe("JWT expiration helpers", () => {
  it("decodes exp timestamp correctly from JWT", () => {
    const expSec = Math.floor(Date.now() / 1000) + 300;
    const jwt = createMockJwt(expSec);
    expect(decodeJwtExp(jwt)).toBe(expSec * 1000);
  });

  it("returns null for invalid JWT strings", () => {
    expect(decodeJwtExp("invalid-token")).toBe(null);
    expect(decodeJwtExp("")).toBe(null);
    expect(decodeJwtExp("a.b")).toBe(null);
  });

  it("identifies expired and near-expiry tokens", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    // Token that expired 10 seconds ago
    const expiredJwt = createMockJwt(nowSec - 10);
    expect(isTokenExpired(expiredJwt)).toBe(true);
    expect(isTokenNearExpiry(expiredJwt)).toBe(true);

    // Token expiring in 60 seconds (within 2-minute threshold)
    const soonJwt = createMockJwt(nowSec + 60);
    expect(isTokenExpired(soonJwt)).toBe(false);
    expect(isTokenNearExpiry(soonJwt, 2 * 60 * 1000)).toBe(true);

    // Token expiring in 10 minutes (outside 2-minute threshold)
    const freshJwt = createMockJwt(nowSec + 600);
    expect(isTokenExpired(freshJwt)).toBe(false);
    expect(isTokenNearExpiry(freshJwt, 2 * 60 * 1000)).toBe(false);
  });
});
