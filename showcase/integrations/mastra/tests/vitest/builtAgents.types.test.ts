/**
 * Type-level test for `BuiltAgents`. It guards the ONE invariant that
 * `src/agent-registry.ts` cannot guard for itself: that `demoAgentNames` keeps
 * its `as const`, and therefore that `BuiltAgents` stays keyed by a literal
 * union instead of `string`.
 *
 * WHY THAT INVARIANT NEEDS A SEPARATE FILE
 * Drop `as const` from `demoAgentNames` and `DemoAgentName` widens to `string`.
 * Every declaration in agent-registry.ts still compiles: `Record<string,
 * LocalMastraAgentName>` accepts the `demoAgentIds` literal, so the totality
 * guarantee that map exists to provide is silently lost, and `BuiltAgents`
 * becomes `Record<string, LocalAgentValue>` — indexable with any typo. No
 * assertion inside agent-registry.ts fails. The assertions below do.
 *
 * WHAT THIS FILE DELIBERATELY NO LONGER DOES
 * It used to hardcode its own copy of the local-agent union and enumerate every
 * demo key in an object literal. Both copies drifted from the source (the union
 * was missing three agents; two demo keys no longer existed), which left the
 * assertions permanently RED inside the accepted `tsc` baseline — and a guard
 * whose failure is expected cannot detect the drift it exists to catch. The
 * unions are now IMPORTED, so there is nothing here left to drift. The
 * mastra-registration invariants those hardcoded copies were reaching for are
 * owned by `src/agent-registry.ts` (`_LocalNamesMatchMastra`,
 * `_BuiltLocalNamesAreRegistered`, `_TableCoversBuiltLocalNames`), which derive
 * them from the live `mastra` instance and fail in the same `tsc` run as the
 * code they constrain.
 *
 * There are zero meaningful runtime assertions — the value of this file is in
 * whether `tsc --noEmit` passes for it.
 */

import { describe, expect, it, vi } from "vitest";

// Stubs so route.ts imports resolve under vitest-node.
vi.mock("@/mastra", () => ({ mastra: { __stub: "mastra" } }));
vi.mock("@ag-ui/mastra", () => ({
  MastraAgent: { getLocalAgents: vi.fn() },
  getLocalAgent: vi.fn(),
}));
vi.mock("@copilotkit/runtime", () => ({
  CopilotRuntime: vi.fn(),
  ExperimentalEmptyAdapter: vi.fn(),
  copilotRuntimeNextJSAppRouterEndpoint: vi.fn(() => ({
    handleRequest: vi.fn(async () => new Response("ok")),
  })),
}));
vi.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  },
}));

import { demoAgentNames } from "../../src/app/api/copilotkit/route";
import type {
  BuiltAgents,
  DemoAgentName,
} from "../../src/app/api/copilotkit/route";
// `BuiltLocalAgentName` is the half of `keyof BuiltAgents` that is NOT demo
// aliases. The route module re-exports `BuiltAgents` / `DemoAgentName` /
// `LocalMastraAgentName` but not this one, so it comes straight from the
// registry. Type-only import: erased at runtime, so it pulls no module in.
import type { BuiltLocalAgentName } from "../../src/agent-registry";

// Helper: "these two types are assignable in both directions" (i.e. equal).
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;

// 1a. `DemoAgentName` must track the entries of `demoAgentNames`. Derived from
//     the runtime constant, so adding a demo in agent-registry.ts requires no
//     edit here. This catches `DemoAgentName` being redeclared independently of
//     the array (e.g. hand-written back into a fixed union).
type _DemoAgentNameTracksTheArray = Assert<
  Equals<DemoAgentName, (typeof demoAgentNames)[number]>
>;

// 1b. …and it must not be `string`. 1a alone does NOT catch a dropped
//     `as const`: without it BOTH sides widen to `string` and the equality
//     holds vacuously — the header comment this file shipped with claimed
//     otherwise. This half is the one that fails.
type _DemoAgentNameIsNotWidened = Assert<
  Equals<DemoAgentName, string> extends true ? false : true
>;

// 2. `BuiltAgents` keys must be exactly `DemoAgentName | BuiltLocalAgentName`.
//    Both sides are imported, so this cannot drift from the source; what it
//    still catches is `BuiltAgents` being widened back to `Record<string, …>`
//    (directly, or indirectly by `demoAgentNames` losing `as const`).
type _BuiltAgentsKeys = Assert<
  Equals<keyof BuiltAgents, DemoAgentName | BuiltLocalAgentName>
>;

// 3. Unknown keys must NOT be indexable. Asserted with `extends keyof` rather
//    than a `@ts-expect-error`-pinned object literal: the old literal had to
//    enumerate EVERY key of the non-partial `BuiltAgents` Record to compile at
//    all, which is precisely the hand-maintained copy that rotted.
type _UnknownKeyIsRejected = Assert<
  "totally-unknown-agent" extends keyof BuiltAgents ? false : true
>;

describe("BuiltAgents type narrowing", () => {
  it("keeps the type-level checks referenced so nothing drops the file", () => {
    // Reference the aliases so they are not flagged as unused, and so the
    // file has a body vitest will run. A `tsc --noEmit` failure above is the
    // real signal.
    const _keep: [
      _DemoAgentNameTracksTheArray,
      _DemoAgentNameIsNotWidened,
      _BuiltAgentsKeys,
      _UnknownKeyIsRejected,
    ] = [true, true, true, true];
    expect(_keep).toEqual([true, true, true, true]);
  });

  it("has no duplicate entries in demoAgentNames", () => {
    // Cheap runtime companion to assertion 1: a duplicated literal collapses
    // in the union and would silently shrink `DemoAgentName` by one name
    // without changing the array's length-based checks elsewhere.
    expect(new Set(demoAgentNames).size).toBe(demoAgentNames.length);
  });
});
