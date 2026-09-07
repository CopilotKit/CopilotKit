import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveKeelUserId,
  resolveKeelUserName,
  keelIdentifyUser,
  memoryScopeUserIds,
  memorySeedTargetUserIds,
  DEMO_DEFAULT_USER_ID,
} from "./user-id";
import { KEEL_PERSONAS } from "@/skins/keel/data/personas";

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

/**
 * THE RESET/RUNTIME IDENTITY CONTRACT — the two derivations the presenter reset
 * asks this module for rather than restating.
 *
 * Every failure here is silent at runtime: the reset returns a plausible count and
 * the demo quietly proves nothing.
 */
describe("memoryScopeUserIds — what the reset must forget", () => {
  it("covers the default bucket, every persona and every role slug", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    const ids = memoryScopeUserIds();
    // The default is the bucket runs ACTUALLY resolve to most of the time, because
    // the client's `properties` do not reliably reach `identifyUser`.
    expect(ids).toContain(DEMO_DEFAULT_USER_ID);
    for (const persona of KEEL_PERSONAS) {
      expect(ids).toContain(`keel-${persona.id}`);
      // The role-slug branch: a role forwarded with no recognised persona id. A
      // hardcoded bucket list in the route missed exactly this class.
      expect(ids).toContain(resolveKeelUserId({ userRole: persona.role }));
    }
  });

  it("has no duplicates, so the reset does not sweep a bucket twice", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    const ids = memoryScopeUserIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("collapses onto the PINNED bucket, because that is the only one a run reads", () => {
    // `playwright.config.ts` pins this. Bellwether's reset carried a hardcoded list
    // and therefore scrubbed buckets nothing was using while every run read the
    // pinned one — beats 4/5 recalled nothing and a taught procedure SURVIVED the
    // reset. Read at call time, never frozen at import, for exactly this reason.
    vi.stubEnv("INTELLIGENCE_USER_ID", "pinned-scope");
    expect(memoryScopeUserIds()).toEqual(["pinned-scope"]);
  });
});

describe("memorySeedTargetUserIds — where beats 4 and 5 are armed", () => {
  it("seeds the DEFAULT bucket as well as every mapped persona's", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    const targets = memorySeedTargetUserIds();
    // Seeding only the mapped persona leaves recall looking at an empty bucket, and
    // beat 4 fails with the agent cheerfully saying it has no saved format — while
    // the memories sit perfectly well stored one id over.
    expect(targets).toContain(DEMO_DEFAULT_USER_ID);
    for (const persona of KEEL_PERSONAS) {
      expect(targets).toContain(`keel-${persona.id}`);
    }
  });

  it("is a subset of what the reset forgets, so nothing is seeded into an unswept bucket", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    const swept = new Set(memoryScopeUserIds());
    for (const target of memorySeedTargetUserIds()) {
      expect(swept.has(target)).toBe(true);
    }
  });

  it("collapses onto the pinned bucket too", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "pinned-scope");
    expect(memorySeedTargetUserIds()).toEqual(["pinned-scope"]);
  });
});
