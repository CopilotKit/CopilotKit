/**
 * The client half of per-passenger memory scoping is two string literals, and both
 * are DUPLICATED on purpose — the traveller id lives in `data/trip-seed.ts` and the
 * role in `intelligence/user-id.ts`, neither of which the client should import (the
 * seed drags a 43-row option grid into the browser bundle; the identity module is
 * server-only by contract). This file is the drift guard that duplication needs.
 *
 * Drift here is silent in the worst possible way: `resolveUserId` falls through to
 * the role slug or the demo default, the run reads a bucket the reset seeded
 * anyway, and beats 4/5 keep working — right up until someone concludes from that
 * that per-traveller scoping works, which it would not.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedTravelers } from "./data/trip-seed";
import {
  ACCOUNT_HOLDER_TRAVELER_ID,
  PASSENGER_ROLE,
  resolveUserId,
} from "./intelligence/user-id";
import {
  AIRLINE_RUNTIME_USER_ID,
  AIRLINE_RUNTIME_USER_ROLE,
  useAirlineRuntimeProperties,
} from "./runtime-properties";

// `resolveUserId` short-circuits on a pinned `INTELLIGENCE_USER_ID`, so leaving the
// ambient env in play would make the mapped-bucket case below pass or fail on
// whatever the shell happened to export. Unpinned explicitly.
beforeEach(() => vi.stubEnv("INTELLIGENCE_USER_ID", ""));
afterEach(() => vi.unstubAllEnvs());

describe("airline runtime properties", () => {
  it("forwards the ACCOUNT HOLDER's traveller id, not some other traveller's", () => {
    const holder = seedTravelers.find((t) => t.accountHolder);
    expect(AIRLINE_RUNTIME_USER_ID).toBe(holder?.id);
    expect(AIRLINE_RUNTIME_USER_ID).toBe(ACCOUNT_HOLDER_TRAVELER_ID);
  });

  it("forwards the role the identity module actually recognises", () => {
    expect(AIRLINE_RUNTIME_USER_ROLE).toBe(PASSENGER_ROLE);
  });

  it("resolves to the MAPPED bucket rather than falling through", () => {
    // The assertion that makes the two above load-bearing: a drifted id or role
    // still resolves to *something*, so identity equality is not enough — this
    // checks the forwarded pair actually lands on the traveller's own scope.
    const properties = useAirlineRuntimeProperties();
    const resolved = resolveUserId({
      travelerId: String(properties.userId),
      role: String(properties.userRole),
    });
    expect(resolved).toBe("aeronova-camila-rojas");
    expect(resolved).not.toBe("aeronova-passenger");
    expect(resolved).not.toBe("aeronova-demo-user");
  });

  it("returns one STABLE, frozen object across calls", () => {
    // `CopilotKitProvider` owns the property bag from its first commit, so a fresh
    // literal per render is a new identity on every pass — and a mutable shared
    // object could be changed out from under the provider by any consumer.
    const a = useAirlineRuntimeProperties();
    const b = useAirlineRuntimeProperties();
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("carries the two keys the runtime contract names, and no others", () => {
    // `identifyUser` reads `{ userRole, userId }`. An extra key is dead weight
    // forwarded on every run; a missing one silently unscopes memory.
    expect(Object.keys(useAirlineRuntimeProperties()).sort()).toEqual([
      "userId",
      "userRole",
    ]);
  });
});
