import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveKeelUserId,
  resolveKeelUserName,
  keelIdentifyUser,
} from "./user-id";

// Two of the four seeded personas (see data/personas.ts).
const ANA = "ana-reyes"; // Ana Reyes, Nurse Manager
const SAM = "sam-okafor"; // Sam Okafor, Privacy Officer

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveKeelUserId", () => {
  it("pin wins over everything (CI determinism)", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "pinned-scope");
    expect(
      resolveKeelUserId({ userId: SAM, userRole: "Privacy Officer" }),
    ).toBe("pinned-scope");
  });

  it("scopes a known persona id to keel-<id> when unpinned", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(resolveKeelUserId({ userId: ANA })).toBe("keel-ana-reyes");
    expect(resolveKeelUserId({ userId: SAM })).toBe("keel-sam-okafor");
  });

  it("falls back to a role-derived scope for an unmapped persona id", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(
      resolveKeelUserId({ userId: "nobody", userRole: "Privacy Officer" }),
    ).toBe("keel-privacy-officer");
  });

  it("falls back to a demo scope when nothing is given", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(resolveKeelUserId({})).toBe("keel-demo-user");
  });
});

describe("resolveKeelUserName", () => {
  it("returns the mapped persona display name when unpinned", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(resolveKeelUserName({ userId: SAM })).toBe("Sam Okafor");
  });

  it("honors the pinned name env when set", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "pinned-scope");
    vi.stubEnv("INTELLIGENCE_USER_NAME", "Pinned User");
    expect(resolveKeelUserName({ userId: ANA })).toBe("Pinned User");
  });

  it("derives a role name when the persona id is unmapped", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(resolveKeelUserName({ userRole: "Privacy Officer" })).toBe(
      "Keel Privacy Officer",
    );
  });
});

// `userId` is untrusted client-forwarded input. Prototype-chain keys of a plain
// object ("constructor", "toString", "__proto__", "hasOwnProperty") must NOT be
// mistaken for a persona: they must not mint a `keel-<key>` memory scope, and
// the name resolver must always return a string (never an inherited function or
// object).
const PROTO_KEYS = [
  "constructor",
  "toString",
  "__proto__",
  "hasOwnProperty",
] as const;

describe("prototype-pollution safety (untrusted userId)", () => {
  it("does not resolve inherited object keys to a persona scope", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    for (const key of PROTO_KEYS) {
      // No role -> must fall through to the demo scope, never `keel-<key>`.
      expect(resolveKeelUserId({ userId: key })).toBe("keel-demo-user");
      // With a role -> must fall through to the role-derived scope.
      expect(
        resolveKeelUserId({ userId: key, userRole: "Privacy Officer" }),
      ).toBe("keel-privacy-officer");
    }
  });

  it("always returns a string name for inherited object keys", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    for (const key of PROTO_KEYS) {
      const name = resolveKeelUserName({ userId: key });
      expect(typeof name).toBe("string");
      expect(name).toBe("Keel Demo User");

      const withRole = resolveKeelUserName({
        userId: key,
        userRole: "Privacy Officer",
      });
      expect(typeof withRole).toBe("string");
      expect(withRole).toBe("Keel Privacy Officer");
    }
  });

  it("keelIdentifyUser yields a string name for inherited object keys", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    for (const key of PROTO_KEYS) {
      const { id, name } = keelIdentifyUser({ userId: key });
      expect(id).toBe("keel-demo-user");
      expect(typeof name).toBe("string");
    }
  });
});

describe("keelIdentifyUser", () => {
  it("composes id + name from the forwarded run properties", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(
      keelIdentifyUser({ userId: SAM, userRole: "Privacy Officer" }),
    ).toEqual({ id: "keel-sam-okafor", name: "Sam Okafor" });
  });

  it("handles undefined properties with the demo identity", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(keelIdentifyUser(undefined)).toEqual({
      id: "keel-demo-user",
      name: "Keel Demo User",
    });
  });
});
