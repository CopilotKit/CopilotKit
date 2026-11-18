import { describe, it, expect, afterEach } from "vitest";
import {
  logisticsIdentifyUser,
  memoryScopeUserIds,
  memorySeedTargetUserIds,
  resolveUserId,
  resolveUserName,
  DEMO_DEFAULT_USER_ID,
} from "./user-id";

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("logistics identity", () => {
  it("maps a known planner id onto a stable scope", () => {
    expect(resolveUserId({ plannerId: "pl-rosa" })).toBe("rosa-delgado");
    expect(resolveUserName({ plannerId: "pl-rosa" })).toBe("Rosa Delgado");
  });

  it("keeps the two planners in separate memory scopes", () => {
    expect(resolveUserId({ plannerId: "pl-rosa" })).not.toBe(
      resolveUserId({ plannerId: "pl-ibrahim" }),
    );
  });

  it("falls back to a role-derived scope for an unmapped planner", () => {
    expect(resolveUserId({ plannerId: "pl-unknown", role: "Director" })).toBe(
      "meridian-director",
    );
  });

  it("falls back to the demo default with no planner and no role", () => {
    expect(resolveUserId({})).toBe(DEMO_DEFAULT_USER_ID);
  });

  it("lets a pinned env id win so CI stays deterministic", () => {
    process.env.INTELLIGENCE_USER_ID = "ci-pinned";
    process.env.INTELLIGENCE_USER_NAME = "CI User";
    expect(resolveUserId({ plannerId: "pl-rosa" })).toBe("ci-pinned");
    expect(resolveUserName({ plannerId: "pl-rosa" })).toBe("CI User");
  });

  it("reads the client-forwarded properties bag", () => {
    expect(
      logisticsIdentifyUser({ userId: "pl-ibrahim", userRole: "Director" }),
    ).toEqual({ id: "ibrahim-okonjo", name: "Ibrahim Okonjo" });
    expect(logisticsIdentifyUser(undefined).id).toBe(DEMO_DEFAULT_USER_ID);
  });

  it("does not resolve an inherited property as a planner", () => {
    // `properties.userId` is client-forwarded and untrusted, and this function
    // decides the DURABLE-MEMORY scope. A plain-object lookup walks the
    // prototype chain, so `"constructor"` would pass a truthiness guard and then
    // yield `undefined` for `.userId` — memory read and written under a bucket
    // nobody intended, silently. A Map has no such entries.
    for (const key of ["constructor", "toString", "valueOf", "__proto__"]) {
      expect(resolveUserId({ plannerId: key })).toBe(DEMO_DEFAULT_USER_ID);
      expect(resolveUserName({ plannerId: key })).toBe("Meridian Demo User");
    }
  });
});

/**
 * ── THE RESET/RUNTIME IDENTITY CONTRACT ────────────────────────────────────
 *
 * These are the assertions that keep the presenter reset pointing at the buckets
 * the runtime actually uses. Every way this can be wrong is SILENT: the reset
 * returns `ok: true` with a plausible count while beats 4/5 recall nothing and a
 * procedure taught in beat 6 survives.
 */
describe("logistics memory buckets", () => {
  it("covers the default bucket, both mapped planners, and both role slugs", () => {
    const ids = memoryScopeUserIds();
    expect(ids).toContain(DEMO_DEFAULT_USER_ID);
    expect(ids).toContain("rosa-delgado");
    expect(ids).toContain("ibrahim-okonjo");
    // The role-slug branch, which a hand-written list would have missed: a
    // planner in seed.json but absent from PLANNER_IDENTITY resolves this way.
    expect(ids).toContain("meridian-planner");
    expect(ids).toContain("meridian-director");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("collapses onto the pinned bucket, which is the only one a run reads", () => {
    process.env.INTELLIGENCE_USER_ID = "ci-pinned";
    expect(memoryScopeUserIds()).toEqual(["ci-pinned"]);
    expect(memorySeedTargetUserIds()).toEqual(["ci-pinned"]);
  });

  it("seeds the DEFAULT bucket as well as the mapped planner's", () => {
    // Not an optimization — a correctness requirement. The client's `properties`
    // frequently do not reach `identifyUser` on the run path, so recall looks at
    // the default bucket; seeding only Rosa's leaves it empty and beat 4 fails
    // with the agent cheerfully saying it has no saved format.
    const targets = memorySeedTargetUserIds();
    expect(targets).toContain(DEMO_DEFAULT_USER_ID);
    expect(targets).toContain("rosa-delgado");
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("seeds only buckets the reset also sweeps", () => {
    // A seed target outside the forget set would survive every reset and
    // accumulate duplicates run over run.
    const swept = new Set(memoryScopeUserIds());
    for (const target of memorySeedTargetUserIds()) {
      expect(swept.has(target)).toBe(true);
    }
  });
});
