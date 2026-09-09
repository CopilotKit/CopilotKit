/**
 * HERMETIC: every case stubs `INTELLIGENCE_USER_ID` / `INTELLIGENCE_USER_NAME`
 * explicitly rather than trusting them to be unset in the ambient shell — a
 * developer with a pinned id exported must not silently turn the unpinned
 * assertions below into assertions about their pin. Nothing here touches the
 * network: `user-id.ts` is pure resolution.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_DEFAULT_USER_ID,
  execIdentifyUser,
  resolveUserId,
  resolveUserName,
  SEED_TARGET_USER_IDS,
  SEEDED_USER_IDS,
} from "./user-id";

beforeEach(() => {
  // "" (not undefined) so the falsy check in `resolveUserId` takes the
  // unpinned path regardless of the developer's ambient .env.
  vi.stubEnv("INTELLIGENCE_USER_ID", "");
  // Deleted, not blanked: `resolveUserName` reads it with `??`, so an empty
  // string would be preferred over the pinned id and mask the pinned-name path.
  vi.stubEnv("INTELLIGENCE_USER_NAME", undefined);
});

/**
 * The stubs above MUTATE `process.env` for the whole fork. Without this
 * teardown they outlive the file: every later suite in the same worker sees a
 * BLANKED `INTELLIGENCE_USER_ID` and a DELETED `INTELLIGENCE_USER_NAME`, so a
 * suite whose subject reads either one is silently testing this file's
 * fixtures. `vi.unstubAllGlobals` in the sibling suites does not cover env —
 * `unstubAllEnvs` is a separate call, and this was the one env-stubbing suite
 * in the skin missing it.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveUserId / resolveUserName", () => {
  it("maps the one on-screen operator onto its own vantage scope", () => {
    expect(resolveUserId({ operatorId: "cascade-chief-of-staff" })).toBe(
      "vantage-chief-of-staff",
    );
    expect(resolveUserName({ operatorId: "cascade-chief-of-staff" })).toBe(
      "Cascade Chief of Staff",
    );
  });

  it("falls back to the KNOWN role, then the demo default", () => {
    // The role the client actually forwards (`../runtime-properties.ts`),
    // matched after slugging so casing and spacing do not fork the bucket.
    expect(
      resolveUserId({ operatorId: "op-unknown", role: "Chief of Staff" }),
    ).toBe("vantage-chief-of-staff");
    expect(resolveUserId({ role: "chief-of-staff" })).toBe(
      "vantage-chief-of-staff",
    );
    expect(resolveUserId({})).toBe(DEMO_DEFAULT_USER_ID);
    expect(resolveUserId()).toBe(DEMO_DEFAULT_USER_ID);
    expect(resolveUserName({})).toBe("Vantage Demo User");
  });

  /**
   * THE DEFECT: the role branch MINTED a bucket from whatever slug the role
   * happened to produce — `userRole` is client-forwarded and therefore
   * untrusted, so `"Board Secretary"` became `vantage-board-secretary`, a real
   * memory scope that Intelligence reads and writes and that `dev/reset` NEVER
   * sweeps: neither `SEEDED_USER_IDS` nor `DEMO_DEFAULT_USER_ID` names it, and
   * they are the whole forget list. Memory taught into such a bucket survives
   * every reset, which is precisely how beat 6 opens already taught.
   *
   * An unknown role now lands in the demo default — a bucket the reset DOES
   * sweep — rather than inventing one nobody clears.
   */
  it("refuses to mint a bucket from an unrecognised role", () => {
    expect(resolveUserId({ role: "Board Secretary" })).toBe(
      DEMO_DEFAULT_USER_ID,
    );
    expect(resolveUserName({ role: "Board Secretary" })).toBe(
      "Vantage Demo User",
    );
  });

  it("treats a role that slugs to nothing as no role at all", () => {
    // `"!!!"`/`"---"` strip to an empty slug — the branch that used to be the
    // only guard against an empty `vantage-` suffix, and was uncovered.
    for (const role of ["!!!", "---", "   ", "…"]) {
      expect(resolveUserId({ role })).toBe(DEMO_DEFAULT_USER_ID);
      expect(resolveUserName({ role })).toBe("Vantage Demo User");
    }
  });

  it("lands the role-only and operator-only paths in the SAME bucket, not two", () => {
    // Both describe one person, so they must share one memory scope: split
    // them and beat 4's seeded preference is stored under one id and recalled
    // under the other, which reads on stage as memory that does not work.
    expect(resolveUserId({ role: "chief-of-staff" })).toBe(
      resolveUserId({ operatorId: "cascade-chief-of-staff" }),
    );
    expect(resolveUserName({ role: "chief-of-staff" })).toBe(
      resolveUserName({ operatorId: "cascade-chief-of-staff" }),
    );
  });

  /**
   * THE INVARIANT `dev/reset` DEPENDS ON: the forget list is static
   * (`SEEDED_USER_IDS` + `DEMO_DEFAULT_USER_ID`, plus a pinned id when one is
   * set), so every bucket this resolver can produce from untrusted input MUST
   * already be in it. A single reachable id outside that set is a bucket the
   * reset silently skips forever.
   */
  it("can only ever resolve a bucket the presenter reset actually sweeps", () => {
    const swept = new Set([...SEEDED_USER_IDS, DEMO_DEFAULT_USER_ID]);
    const OPERATORS = [
      undefined,
      "",
      "cascade-chief-of-staff",
      "op-unknown",
      "__proto__",
      "constructor",
      "Cascade-Chief-Of-Staff",
    ];
    const ROLES = [
      undefined,
      "",
      "chief-of-staff",
      "Chief of Staff",
      "CHIEF OF STAFF",
      "Board Secretary",
      "!!!",
      "../../etc/passwd",
      "toString",
      "a".repeat(200),
    ];
    for (const operatorId of OPERATORS) {
      for (const role of ROLES) {
        const id = resolveUserId({ operatorId, role });
        expect(
          swept.has(id),
          `${String(operatorId)}/${String(role)} → ${id}`,
        ).toBe(true);
      }
    }
  });

  it("lets a pinned id win over a mapped operator", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "pinned-scope");
    expect(resolveUserId({ operatorId: "cascade-chief-of-staff" })).toBe(
      "pinned-scope",
    );
    expect(resolveUserName({ operatorId: "cascade-chief-of-staff" })).toBe(
      "pinned-scope",
    );
    vi.stubEnv("INTELLIGENCE_USER_NAME", "Pinned Person");
    expect(resolveUserName({ operatorId: "cascade-chief-of-staff" })).toBe(
      "Pinned Person",
    );
  });

  it("namespaces every seeded and seed-target id to vantage", () => {
    for (const id of [...SEEDED_USER_IDS, ...SEED_TARGET_USER_IDS]) {
      expect(id.startsWith("vantage-")).toBe(true);
    }
    // The default bucket is a seed target on purpose — runs resolve to it.
    expect(SEED_TARGET_USER_IDS).toContain(DEMO_DEFAULT_USER_ID);
    expect(SEED_TARGET_USER_IDS).toContain("vantage-chief-of-staff");
    // Despite the name, this is the SWEEP list, not the seed list — see its
    // doc comment. `SEED_TARGET_USER_IDS` is what actually gets seeded.
    expect(SEEDED_USER_IDS).toEqual(["vantage-chief-of-staff"]);
  });
});

/**
 * The operator table is keyed by `properties.userId`, which is client-forwarded
 * and therefore UNTRUSTED. While that table was a plain object literal, an
 * `operatorId` of `"toString"` / `"constructor"` / `"__proto__"` walked the
 * PROTOTYPE CHAIN, resolved truthy past the `operatorId && OPERATOR_IDENTITY[…]`
 * guard, and then `.userId` / `.userName` on the inherited member was
 * `undefined` — so this function, which decides the DURABLE-MEMORY SCOPE, handed
 * Intelligence an `undefined` bucket. Silently: reads and writes would land
 * somewhere no reset ever sweeps, and beats 4/5/6 all depend on that scope being
 * exactly right. `Map.get` only sees own entries, so the bad state stops being
 * representable instead of being guarded per call site.
 *
 * These are the identifiers a plain-object lookup actually leaks, not an
 * arbitrary fuzz list: `"__proto__"` yields `Object.prototype`, the others yield
 * inherited functions. Mirrors commerce's and keel's equivalent suites.
 */
describe("operator lookup rejects inherited Object.prototype keys", () => {
  const INHERITED_KEYS = [
    "toString",
    "constructor",
    "__proto__",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
  ] as const;

  it.each(INHERITED_KEYS)(
    "does not resolve %s as an operator, and never yields an undefined id",
    (key) => {
      // No role: must land on the demo default, exactly as any other unmapped id.
      expect(resolveUserId({ operatorId: key })).toBe(DEMO_DEFAULT_USER_ID);
      // With a KNOWN role: the role branch, not the "mapped operator" branch —
      // and a prototype hit would have returned `undefined` from either.
      expect(resolveUserId({ operatorId: key, role: "chief-of-staff" })).toBe(
        "vantage-chief-of-staff",
      );
      expect(resolveUserName({ operatorId: key })).toBe("Vantage Demo User");
      expect(resolveUserName({ operatorId: key, role: "chief-of-staff" })).toBe(
        "Cascade Chief of Staff",
      );
    },
  );

  it.each(INHERITED_KEYS)(
    "keeps %s out of the memory scope the runtime actually identifies with",
    (key) => {
      // Through `execIdentifyUser` — the entry point `agent-registry.ts` calls
      // with whatever the client forwarded.
      const identity = execIdentifyUser({ userId: key });
      expect(identity.id).toBe(DEMO_DEFAULT_USER_ID);
      expect(identity.name).toBe("Vantage Demo User");
      // The precise failure mode: never `undefined`, never a stringified
      // function leaking Object.prototype into a memory bucket.
      expect(typeof identity.id).toBe("string");
      expect(typeof identity.name).toBe("string");
      expect(identity.id).not.toBe("vantage-chief-of-staff");
    },
  );

  it("still resolves the real operator exactly as before", () => {
    // The other half of the fix: refuse the illegitimate keys WITHOUT moving
    // any legitimate operator's id — `dev/reset`'s forget/seed sets are derived
    // from these, so a shift here would silently relocate the buckets.
    expect(execIdentifyUser({ userId: "cascade-chief-of-staff" })).toEqual({
      id: "vantage-chief-of-staff",
      name: "Cascade Chief of Staff",
    });
    expect(execIdentifyUser(undefined)).toEqual({
      id: DEMO_DEFAULT_USER_ID,
      name: "Vantage Demo User",
    });
  });
});
