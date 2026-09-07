/**
 * This module decides which durable-memory BUCKET a run reads and writes, so every
 * defect in it is a memory beat that quietly recalls nothing. Four things are
 * pinned.
 *
 *  1. The pinned-env short-circuit, which Playwright relies on and which collapses
 *     the bucket set to one. A reset that swept a roster-derived list while the run
 *     wrote the pinned bucket is the exact bug commerce shipped.
 *  2. Prototype-chain safety. `properties.userId` is client-forwarded and
 *     untrusted, and a plain-object lookup resolves `"constructor"` TRUTHY, then
 *     reads `undefined` off the inherited member — memories under a bucket nobody
 *     intended, silently.
 *  3. The seed targets include the DEFAULT bucket as well as the mapped traveller,
 *     because runs frequently resolve to the default.
 *  4. The forget set is a superset of the seed set, or a reset leaves a seeded row
 *     behind that it then re-seeds on top of.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedTravelers } from "../data/trip-seed";
import {
  ACCOUNT_HOLDER_TRAVELER_ID,
  DEMO_DEFAULT_USER_ID,
  PASSENGER_ROLE,
  airlineIdentifyUser,
  memoryScopeUserIds,
  memorySeedTargetUserIds,
  resolveUserId,
  resolveUserName,
} from "./user-id";

afterEach(() => vi.unstubAllEnvs());

/** Unpinned by default — every case that wants the pin sets it explicitly. */
function unpinned() {
  vi.stubEnv("INTELLIGENCE_USER_ID", "");
  vi.stubEnv("INTELLIGENCE_USER_NAME", "");
}

describe("airline resolveUserId", () => {
  it("derives the account holder from the seed rather than restating one", () => {
    const holder = seedTravelers.find((t) => t.accountHolder);
    expect(holder).toBeDefined();
    expect(ACCOUNT_HOLDER_TRAVELER_ID).toBe(holder?.id);
  });

  it("maps every seeded traveller onto a distinct, ASCII-folded bucket", () => {
    unpinned();
    const ids = seedTravelers.map((t) => resolveUserId({ travelerId: t.id }));
    // 1:1 — two people on screen must never share one memory scope.
    expect(new Set(ids).size).toBe(seedTravelers.length);
    // Legible in the Intelligence inspector, which is where a presenter debugging
    // "why did it not remember" actually looks. Spanish names must not slug to
    // `aeronova-tom-s-aguirre`.
    for (const id of ids) expect(id).toMatch(/^aeronova-[a-z0-9-]+$/);
    expect(resolveUserId({ travelerId: "tv-tomas" })).toBe(
      "aeronova-tomas-aguirre",
    );
    expect(resolveUserId({ travelerId: "tv-ines" })).toBe(
      "aeronova-ines-vidal",
    );
  });

  it("falls back to the role slug, then to the demo default", () => {
    unpinned();
    expect(resolveUserId({ role: PASSENGER_ROLE })).toBe("aeronova-passenger");
    expect(resolveUserId({})).toBe(DEMO_DEFAULT_USER_ID);
    expect(resolveUserId()).toBe(DEMO_DEFAULT_USER_ID);
    // A role that slugs to nothing is the default, not `aeronova-`.
    expect(resolveUserId({ role: "///" })).toBe(DEMO_DEFAULT_USER_ID);
  });

  it("short-circuits on a pinned env, which is what CI depends on", () => {
    vi.stubEnv("INTELLIGENCE_USER_ID", "pinned-user");
    expect(resolveUserId({ travelerId: ACCOUNT_HOLDER_TRAVELER_ID })).toBe(
      "pinned-user",
    );
    expect(resolveUserId({})).toBe("pinned-user");
    // And both bucket sets collapse onto it, so the reset scrubs the ONE bucket
    // the runtime will actually read.
    expect(memoryScopeUserIds()).toEqual(["pinned-user"]);
    expect(memorySeedTargetUserIds()).toEqual(["pinned-user"]);
  });

  it("cannot be walked out of the roster through the prototype chain", () => {
    unpinned();
    // A plain-object lookup resolves each of these TRUTHY and then reads
    // `undefined` off the inherited member — the worst outcome for a function that
    // decides a memory scope. `Map.get` sees own entries only, so each of these
    // falls through to the role/default branch instead.
    for (const hostile of [
      "toString",
      "constructor",
      "valueOf",
      "__proto__",
      "hasOwnProperty",
    ]) {
      expect(resolveUserId({ travelerId: hostile })).toBe(DEMO_DEFAULT_USER_ID);
      expect(resolveUserName({ travelerId: hostile })).toBe(
        "Aeronova Demo Passenger",
      );
    }
  });
});

describe("airline resolveUserName", () => {
  it("names the mapped traveller, the role, or the demo passenger", () => {
    unpinned();
    expect(resolveUserName({ travelerId: ACCOUNT_HOLDER_TRAVELER_ID })).toBe(
      "Camila Rojas",
    );
    expect(resolveUserName({ role: PASSENGER_ROLE })).toBe(
      "Aeronova passenger",
    );
    expect(resolveUserName({})).toBe("Aeronova Demo Passenger");
  });

  it("honours the pinned name, falling back to the pinned id", () => {
    // `undefined`, not `""`: the fallback is `??`, so an env set to the empty
    // string is a deliberate empty name rather than an absent one. Stubbing `""`
    // here would assert the opposite of what the code does and pass for the wrong
    // reason once someone "fixed" it to `||`.
    vi.stubEnv("INTELLIGENCE_USER_ID", "pinned-user");
    vi.stubEnv("INTELLIGENCE_USER_NAME", undefined);
    expect(resolveUserName({})).toBe("pinned-user");
    vi.stubEnv("INTELLIGENCE_USER_NAME", "Pinned Person");
    expect(resolveUserName({})).toBe("Pinned Person");
  });
});

describe("airline memory bucket sets", () => {
  it("seeds the DEFAULT bucket as well as the account holder's", () => {
    unpinned();
    const targets = memorySeedTargetUserIds();
    // Seeding only the mapped traveller is the failure people, banking and commerce
    // all hit: runs frequently resolve to the default, so recall looks at an empty
    // bucket while the memories sit perfectly well stored one id over.
    expect(targets).toContain(DEMO_DEFAULT_USER_ID);
    expect(targets).toContain(
      resolveUserId({ travelerId: ACCOUNT_HOLDER_TRAVELER_ID }),
    );
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("forgets a SUPERSET of what it seeds, covering every reachable bucket", () => {
    unpinned();
    const forget = new Set(memoryScopeUserIds());
    for (const target of memorySeedTargetUserIds()) {
      expect(forget, `${target} is seeded but never swept`).toContain(target);
    }
    // Every traveller and the role slug too — a bucket the sweep misses is a
    // memory the demo starts out already knowing.
    for (const t of seedTravelers) {
      expect(forget).toContain(resolveUserId({ travelerId: t.id }));
    }
    expect(forget).toContain("aeronova-passenger");
    expect(forget).toContain(DEMO_DEFAULT_USER_ID);
  });
});

describe("airlineIdentifyUser", () => {
  it("maps the client's forwarded properties onto id and name", () => {
    unpinned();
    expect(
      airlineIdentifyUser({
        userId: ACCOUNT_HOLDER_TRAVELER_ID,
        userRole: PASSENGER_ROLE,
      }),
    ).toEqual({ id: "aeronova-camila-rojas", name: "Camila Rojas" });
  });

  it("resolves the default identity when nothing was forwarded", () => {
    // THE COMMON CASE on a run, not an edge case — which is why the reset seeds
    // this bucket too.
    unpinned();
    expect(airlineIdentifyUser(undefined)).toEqual({
      id: DEMO_DEFAULT_USER_ID,
      name: "Aeronova Demo Passenger",
    });
  });
});
