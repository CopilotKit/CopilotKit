import { beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "../data/store";
import {
  commerceIdentifyUser,
  DEMO_DEFAULT_USER_ID,
  memoryScopeUserIds,
  memorySeedTargetUserIds,
  resolveUserId,
  resolveUserName,
} from "./user-id";
import type { IdentityInput } from "./user-id";

/**
 * COMPILE-TIME half of the drift guard, and the reason it is worth the four
 * lines: `runtimeReachableIds()` below enumerates identity inputs by hand, so it
 * can only stay complete if someone WIDENING `IdentityInput` is forced to look at
 * it. Add a third dimension (a team, a tenant, an org) and `tsc --noEmit` fails
 * right here with a missing property — instead of the reset silently leaving that
 * dimension's buckets unforgotten, which is not observable from any test result.
 */
const ENUMERATED_IDENTITY_DIMENSIONS: Record<
  keyof Required<IdentityInput>,
  true
> = { operatorId: true, role: true };

/**
 * THE RESET/RUNTIME IDENTITY DRIFT GUARD.
 *
 * The presenter reset forgets and re-seeds durable memory for a SET of user ids.
 * The runtime writes memory under whatever `resolveUserId` returns. Nothing in
 * the type system ties the two together, and every way they can disagree is
 * SILENT — the reset returns `ok: true` with a plausible `forgot` count, recall
 * quietly reads an empty bucket, and a procedure taught on stage survives into
 * the next run. So this file is the only thing standing between a refactor and a
 * demo that proves nothing.
 *
 * The failure it was written for actually shipped: the reset carried a hardcoded
 * list of three `bellwether-*` ids, while `resolveUserId` short-circuits on a
 * pinned `INTELLIGENCE_USER_ID` that `playwright.config.ts` sets to banking's
 * `jordan-beamson`. Every e2e commerce run therefore read and wrote BANKING's
 * bucket, and the reset scrubbed three buckets nothing was using.
 *
 * The enumeration below is deliberately INDEPENDENT of the source's own: it goes
 * through `commerceIdentifyUser` (the entry point the runtime actually calls) and
 * takes its operator inputs from the live ledger (`store.operators()`, what the
 * `/ledger` endpoint serves the client), in exactly the property shape
 * `useCommerceRuntimeProperties` forwards. If the two enumerations ever disagree,
 * one of them is wrong and the demo is broken.
 */
function runtimeReachableIds(): Set<string> {
  const ids = new Set<string>();
  // Nothing forwarded — the COMMON case on a run, not an edge case.
  ids.add(commerceIdentifyUser(undefined).id);
  ids.add(commerceIdentifyUser({}).id);
  for (const operator of store.operators()) {
    // Exactly what `useCommerceRuntimeProperties` sends.
    ids.add(
      commerceIdentifyUser({ userId: operator.id, userRole: operator.role }).id,
    );
    // A role arrived without a recognised operator id.
    ids.add(commerceIdentifyUser({ userRole: operator.role }).id);
    // An operator the identity map does not know: the role-slug branch. This is
    // the one an author trips by adding a person to `seed.ts` and forgetting
    // `OPERATOR_IDENTITY`.
    ids.add(
      commerceIdentifyUser({ userId: "op-not-in-map", userRole: operator.role })
        .id,
    );
  }
  return ids;
}

beforeEach(() => {
  store.reset();
  // Unpinned unless a test says otherwise. `stubEnv` with "" (not undefined) so
  // the falsy check in `resolveUserId` takes the unpinned path regardless of the
  // developer's ambient .env.
  vi.stubEnv("INTELLIGENCE_USER_ID", "");
  // Deleted, not blanked: `resolveUserName` reads it with `??`, so an empty
  // string would be preferred over the pinned id and mask the pinned-name path.
  vi.stubEnv("INTELLIGENCE_USER_NAME", undefined);
});

describe("memoryScopeUserIds (the presenter reset's bucket set)", () => {
  it("equals every id the runtime can resolve, unpinned", () => {
    expect(new Set(memoryScopeUserIds())).toEqual(runtimeReachableIds());
  });

  it("equals every id the runtime can resolve when INTELLIGENCE_USER_ID is pinned", () => {
    // The regression: Playwright pins this to banking's id, so the reset MUST
    // follow the pin into that bucket instead of scrubbing `bellwether-*`.
    vi.stubEnv("INTELLIGENCE_USER_ID", "jordan-beamson");
    expect(new Set(memoryScopeUserIds())).toEqual(runtimeReachableIds());
    // And the pin collapses the set: one bucket, the pinned one.
    expect([...memoryScopeUserIds()]).toEqual(["jordan-beamson"]);
  });

  it("covers the default bucket and both mapped operators when unpinned", () => {
    // Named explicitly, because "derived from resolveUserId" is only reassuring
    // if the derivation reaches the buckets the demo actually depends on: the
    // default one (where mid-demo teaching lands) and each operator's own.
    expect(memoryScopeUserIds()).toContain(DEMO_DEFAULT_USER_ID);
    expect(memoryScopeUserIds()).toContain("bellwether-nadia-okonjo");
    expect(memoryScopeUserIds()).toContain("bellwether-theo-vance");
  });

  it("is read per call, not frozen at module load", () => {
    // A module-level constant would answer for whatever the env was at import
    // time — which is how the pinned case got missed in the first place.
    vi.stubEnv("INTELLIGENCE_USER_ID", "pinned-a");
    expect([...memoryScopeUserIds()]).toEqual(["pinned-a"]);
    vi.stubEnv("INTELLIGENCE_USER_ID", "");
    expect(memoryScopeUserIds().length).toBeGreaterThan(1);
  });

  it("enumerates every dimension IdentityInput has", () => {
    // The runtime assertion is nearly free; the value is the type annotation on
    // ENUMERATED_IDENTITY_DIMENSIONS, which makes `tsc --noEmit` fail when a new
    // identity dimension is added — the case where a reset would silently stop
    // covering every bucket the runtime can reach.
    expect(Object.keys(ENUMERATED_IDENTITY_DIMENSIONS).sort()).toEqual([
      "operatorId",
      "role",
    ]);
  });

  it("has no duplicates, so a reset never forgets one bucket twice", () => {
    const ids = memoryScopeUserIds();
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe("memorySeedTargetUserIds (the buckets beats 4/5 are seeded into)", () => {
  // Both env states, because the pinned one is the case that actually broke: a
  // hardcoded seed list stays a valid subset unpinned and stops being one the
  // moment a pin redirects the runtime elsewhere.
  it.each([
    ["unpinned", ""],
    ["pinned", "jordan-beamson"],
  ])("only ever seeds a bucket the reset also forgets (%s)", (_label, pin) => {
    // A seed target outside the forget set accumulates duplicate memories on
    // every reset; a seed target outside the RUNTIME's set is dead seed that
    // recall never reads. Containment in the forget set rules out both, because
    // the forget set is the runtime's set.
    vi.stubEnv("INTELLIGENCE_USER_ID", pin);
    const scopes = new Set(memoryScopeUserIds());
    const targets = memorySeedTargetUserIds();
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(scopes).toContain(target);
    }
  });

  it("seeds the default bucket AND the seeded operator, unpinned", () => {
    // Both, on purpose: runs frequently resolve to the default bucket because
    // `properties` do not always reach `identifyUser`, so seeding only the
    // operator leaves beat 4 recalling nothing.
    expect([...memorySeedTargetUserIds()].sort()).toEqual(
      ["bellwether-demo-user", "bellwether-nadia-okonjo"].sort(),
    );
  });

  it("follows a pinned INTELLIGENCE_USER_ID onto the single bucket runs will read", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "jordan-beamson");
    expect([...memorySeedTargetUserIds()]).toEqual(["jordan-beamson"]);
  });
});

describe("resolveUserId / resolveUserName", () => {
  it("maps each operator 1:1 so two on-screen people never share a scope", () => {
    expect(resolveUserId({ operatorId: "op-nadia" })).toBe(
      "bellwether-nadia-okonjo",
    );
    expect(resolveUserId({ operatorId: "op-theo" })).toBe(
      "bellwether-theo-vance",
    );
    expect(resolveUserId({ operatorId: "op-nadia" })).not.toBe(
      resolveUserId({ operatorId: "op-theo" }),
    );
  });

  it("falls back to a namespaced role slug, then the demo default", () => {
    expect(
      resolveUserId({ operatorId: "op-unknown", role: "merch-lead" }),
    ).toBe("bellwether-merch-lead");
    expect(resolveUserId({})).toBe(DEMO_DEFAULT_USER_ID);
  });

  it("lets a pinned id win over a mapped operator", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "pinned-scope");
    expect(resolveUserId({ operatorId: "op-nadia" })).toBe("pinned-scope");
    expect(resolveUserName({ operatorId: "op-nadia" })).toBe("pinned-scope");
  });

  it("namespaces every unpinned id to bellwether, so Rowan's memories cannot leak in", () => {
    for (const id of memoryScopeUserIds()) {
      expect(id.startsWith("bellwether-")).toBe(true);
    }
  });
});

/**
 * The operator table is keyed by `properties.userId`, which is client-forwarded
 * and therefore untrusted. When that table was a plain object literal, an
 * `operatorId` of `"toString"` / `"constructor"` / `"__proto__"` walked the
 * PROTOTYPE CHAIN, resolved truthy past the `operatorId && …` guard, and then
 * `.userId` / `.userName` on the inherited member was `undefined` — so this
 * function, which decides the durable-memory scope, handed Intelligence an
 * `undefined` bucket. Silently: writes and reads would go somewhere nobody
 * intended, and beats 4/5/6 depend on that scope being exactly right.
 *
 * These are the identifiers a plain-object lookup leaks, not an arbitrary fuzz
 * list: `"__proto__"` yields `Object.prototype`, the other two yield functions.
 */
describe("operator lookup rejects inherited Object.prototype keys", () => {
  const INHERITED_KEYS = [
    "toString",
    "constructor",
    "__proto__",
    "valueOf",
    "hasOwnProperty",
  ] as const;

  it.each(INHERITED_KEYS)(
    "does not resolve %s as an operator, and never yields an undefined id",
    (key) => {
      // No role: must land on the demo default, exactly as any other unmapped id.
      expect(resolveUserId({ operatorId: key })).toBe(DEMO_DEFAULT_USER_ID);
      // With a role: must take the role-slug branch, not the "mapped" branch.
      expect(resolveUserId({ operatorId: key, role: "merch-lead" })).toBe(
        "bellwether-merch-lead",
      );
      // The name half of the same table, which had the identical guard.
      expect(resolveUserName({ operatorId: key })).toBe("Bellwether Demo User");
      expect(resolveUserName({ operatorId: key, role: "merch-lead" })).toBe(
        "Bellwether merch-lead",
      );
    },
  );

  it.each(INHERITED_KEYS)(
    "keeps %s out of the memory scope the runtime actually identifies with",
    (key) => {
      // Through `commerceIdentifyUser`, the entry point the runtime calls with
      // whatever the client forwarded.
      const identity = commerceIdentifyUser({ userId: key });
      expect(identity.id).toBe(DEMO_DEFAULT_USER_ID);
      expect(identity.name).toBe("Bellwether Demo User");
      // The precise failure mode: a string, never undefined and never a
      // stringified function leaking Object.prototype into a memory bucket.
      expect(typeof identity.id).toBe("string");
      expect(typeof identity.name).toBe("string");
      // And it must never be mistaken for one of the real operators.
      expect(identity.id).not.toBe("bellwether-nadia-okonjo");
      expect(identity.id).not.toBe("bellwether-theo-vance");
    },
  );

  it("still resolves every seeded operator exactly as before", () => {
    // The other half of the fix: refuse the illegitimate keys WITHOUT changing
    // which id any legitimate operator produces — the reset's forget/seed sets
    // are derived from these, so a shift here would silently move the buckets.
    const expected = new Map([
      ["op-nadia", { id: "bellwether-nadia-okonjo", name: "Nadia Okonjo" }],
      ["op-theo", { id: "bellwether-theo-vance", name: "Theo Vance" }],
    ]);
    for (const operator of store.operators()) {
      const mapped = expected.get(operator.id);
      // Guards the assertion itself: if `seed.ts` grows an operator, this fails
      // here rather than silently asserting nothing about the new person.
      expect(
        mapped,
        `no expectation recorded for ${operator.id}`,
      ).toBeDefined();
      expect(resolveUserId({ operatorId: operator.id })).toBe(mapped!.id);
      expect(resolveUserName({ operatorId: operator.id })).toBe(mapped!.name);
      // Including through the runtime entry point, with the role forwarded the
      // way `useCommerceRuntimeProperties` actually sends it.
      expect(
        commerceIdentifyUser({ userId: operator.id, userRole: operator.role }),
      ).toEqual({ id: mapped!.id, name: mapped!.name });
    }
  });
});
