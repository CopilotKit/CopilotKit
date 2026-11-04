import { afterEach, describe, expect, it, vi } from "vitest";
import { lockedSkinId } from "./locked-skin";

afterEach(() => vi.unstubAllEnvs());

describe("lockedSkinId", () => {
  it("is null when the env var is unset", () => {
    vi.stubEnv("LOCK_SKIN", "");
    expect(lockedSkinId()).toBeNull();
  });

  it("is null for whitespace, so a stray space in .env does not lock the app", () => {
    vi.stubEnv("LOCK_SKIN", "   ");
    expect(lockedSkinId()).toBeNull();
  });

  it("returns a registered skin id", () => {
    vi.stubEnv("LOCK_SKIN", "banking");
    expect(lockedSkinId()).toBe("banking");
  });

  it("tolerates surrounding whitespace on a valid id", () => {
    vi.stubEnv("LOCK_SKIN", "  airline  ");
    expect(lockedSkinId()).toBe("airline");
  });

  it("throws on an unknown id rather than silently 404ing the whole app", () => {
    // A typo would make every skin 404 AND send / to a 404 — the entire app dark.
    // Failing loudly at the point of misconfiguration is the whole point.
    vi.stubEnv("LOCK_SKIN", "bankng");
    expect(() => lockedSkinId()).toThrow(/bankng/);
  });

  it("names the valid ids in the error, so the fix is obvious from the message", () => {
    vi.stubEnv("LOCK_SKIN", "nope");
    expect(() => lockedSkinId()).toThrow(/banking/);
  });

  it("is case-sensitive — ids are URL route segments, so Banking is not banking", () => {
    vi.stubEnv("LOCK_SKIN", "Banking");
    expect(() => lockedSkinId()).toThrow();
  });
});
