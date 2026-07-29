import { describe, it, expect } from "vitest";
import { isValidAppUserId, isValidIdentifier } from "../intelligence-utils";

const TEAMS_APP_USER_ID = `teams:tenant1:29:1${"a".repeat(200)}`;

describe("isValidAppUserId", () => {
  it("accepts a long opaque Teams app-user id that isValidIdentifier rejects", () => {
    // The whole point of the split (OSS-643): a real Teams MRI exceeds the
    // 128-char safe-slug bound, and mangling it to fit is not an option because
    // it must match the identity canonical threads were created with.
    expect(isValidAppUserId(TEAMS_APP_USER_ID)).toBe(true);
    expect(isValidIdentifier(TEAMS_APP_USER_ID)).toBe(false);
  });

  it("accepts a workspace-scoped Slack app-user id", () => {
    expect(isValidAppUserId("slack:T0123456789:U0123456789")).toBe(true);
  });

  it("accepts the punctuation real provider ids contain", () => {
    expect(isValidAppUserId("slack:T-1:U_9.a@b=c")).toBe(true);
  });

  it("rejects empty and whitespace-only ids", () => {
    expect(isValidAppUserId("")).toBe(false);
    expect(isValidAppUserId("   ")).toBe(false);
  });

  it("rejects embedded whitespace", () => {
    expect(isValidAppUserId("slack:T1:U 9")).toBe(false);
  });

  it("rejects CR/LF so the id cannot forge an outbound header", () => {
    expect(isValidAppUserId("slack:T1:U9\r\nx-injected: 1")).toBe(false);
    expect(isValidAppUserId("slack:T1:U9\nx-injected: 1")).toBe(false);
  });

  it("rejects control characters and DEL", () => {
    expect(isValidAppUserId("slack:T1:U\u00009")).toBe(false);
    expect(isValidAppUserId("slack:T1:U\u001f9")).toBe(false);
    expect(isValidAppUserId("slack:T1:U\u007f9")).toBe(false);
  });

  it("rejects a non-string and an over-long id", () => {
    expect(isValidAppUserId(42)).toBe(false);
    expect(isValidAppUserId(undefined)).toBe(false);
    expect(isValidAppUserId(null)).toBe(false);
    expect(isValidAppUserId("x".repeat(512))).toBe(true);
    expect(isValidAppUserId("x".repeat(513))).toBe(false);
  });
});

describe("isValidIdentifier", () => {
  it("stays strict for agent and route identifiers", () => {
    expect(isValidIdentifier("my-agent")).toBe(true);
    expect(isValidIdentifier("agent/../etc")).toBe(false);
    expect(isValidIdentifier("x".repeat(129))).toBe(false);
    expect(isValidIdentifier("")).toBe(false);
  });
});
