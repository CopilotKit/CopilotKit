import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";

// Side-effect import: triggers registerD5Script(...) at module-load.
// Tests below verify the resulting registry state and the script's
// pure functions. We intentionally do NOT clear+re-import between
// tests — the registry's Map identity must remain consistent with
// the script's view of it, and `vi.resetModules()` would break that
// (the script and the test would end up with different module
// instances of d5-registry, each with its own Map).
import {
  TURN_1_INPUT,
  TURN_2_INPUT,
  buildTurns,
  preNavigateRoute,
} from "./d5-shared-state.js";

/**
 * Unit tests for the D5 shared-state script.
 *
 * Coverage:
 *   1. Side-effect registration: the import alone registered the
 *      script under BOTH `shared-state-read` and `shared-state-write`
 *      with `fixtureFile: "shared-state.json"`.
 *   2. `buildTurns` returns ≥ 2 turns whose inputs mirror the
 *      canonical fixture's `userMessage` matchers verbatim.
 *   3. Turn 2's assertion catches missing state retention — i.e. a
 *      response that doesn't contain "blue" must throw. This is THE
 *      invariant the probe enforces.
 *   4. `preNavigateRoute` returns split paths per featureType and
 *      defends against unknown values.
 */

interface PageScript {
  /** Lowercased text the page-side `evaluate` should return. */
  evaluateText: string;
}

function makePage(script: PageScript): Page {
  return {
    async waitForSelector() {
      /* no-op */
    },
    async fill() {
      /* no-op */
    },
    async press() {
      /* no-op */
    },
    async evaluate(_fn) {
      // The script's `readLatestAssistantText` always returns
      // lowercased text. Tests pre-lowercase their fixture so the
      // returned string is stable.
      return script.evaluateText as never;
    },
  };
}

const CTX: D5BuildContext = {
  integrationSlug: "langgraph-python",
  featureType: "shared-state-read",
  baseUrl: "https://showcase-langgraph-python.example.com",
};

describe("d5-shared-state script registration", () => {
  it("registers under BOTH shared-state-read and shared-state-write on import", () => {
    const read = getD5Script("shared-state-read");
    const write = getD5Script("shared-state-write");

    expect(read).toBeDefined();
    expect(write).toBeDefined();
    // Single script registered twice — same object reference under both keys.
    expect(read).toBe(write);
    expect(read?.fixtureFile).toBe("shared-state.json");
    expect(read?.featureTypes).toEqual([
      "shared-state-read",
      "shared-state-write",
    ]);
  });

  it("registered script's buildTurns is the same function the module exports", () => {
    const script = getD5Script("shared-state-read");
    expect(script?.buildTurns).toBe(buildTurns);
  });

  it("registered script's preNavigateRoute matches the exported route map", () => {
    const script = getD5Script("shared-state-read");

    expect(script?.preNavigateRoute).toBe(preNavigateRoute);
    expect(script?.preNavigateRoute?.("shared-state-read")).toBe(
      "/demos/shared-state-read",
    );
    expect(script?.preNavigateRoute?.("shared-state-write")).toBe(
      "/demos/shared-state-write",
    );
  });
});

describe("d5-shared-state buildTurns", () => {
  it("returns ≥ 2 turns whose inputs mirror the fixture verbatim", () => {
    const turns = buildTurns(CTX);
    expect(turns.length).toBeGreaterThanOrEqual(2);

    // Turn 1 input MUST match the fixture's `userMessage` matcher
    // verbatim. Drift here means showcase-aimock falls through to a
    // different / no fixture. The named export is the single source
    // of truth — assert against it.
    expect(turns[0]!.input).toBe(TURN_1_INPUT);
    expect(turns[0]!.input).toBe("remember that my favorite color is blue");

    // Turn 2 input must contain the substring `favorite color` so the
    // fixture's substring matcher fires. The phrasing reads as a
    // natural recall question.
    expect(turns[1]!.input).toBe(TURN_2_INPUT);
    expect(turns[1]!.input.toLowerCase()).toContain("favorite color");

    // Both turns must declare assertions — assertion-less turns
    // would let a regression slip through silently.
    expect(turns[0]!.assertions).toBeDefined();
    expect(turns[1]!.assertions).toBeDefined();
  });
});

describe("d5-shared-state turn 2 invariant (state retention)", () => {
  it("FAILS when the response does not contain 'blue' (regression: state lost)", async () => {
    const turns = buildTurns(CTX);
    const turn2 = turns[1]!;

    // Simulate the regression: shared state did not persist, so the
    // agent has no idea what color the user asked it to remember.
    const page = makePage({
      evaluateText: "i don't recall any preferences from our conversation.",
    });

    await expect(turn2.assertions!(page)).rejects.toThrow(
      /shared state did not persist/i,
    );
  });

  it("PASSES when the response contains 'blue'", async () => {
    const turns = buildTurns(CTX);
    const turn2 = turns[1]!;

    const page = makePage({
      evaluateText: "your favorite color is blue — i noted it earlier.",
    });

    // Assertion must NOT throw on a passing response.
    await expect(turn2.assertions!(page)).resolves.toBeUndefined();
  });

  it("FAILS when no assistant message text is found at all", async () => {
    const turns = buildTurns(CTX);
    const turn2 = turns[1]!;

    const page = makePage({ evaluateText: "" });

    await expect(turn2.assertions!(page)).rejects.toThrow(
      /no assistant message text found/i,
    );
  });
});

describe("d5-shared-state turn 1 relevance check", () => {
  it("PASSES when response mentions color or blue", async () => {
    const turns = buildTurns(CTX);
    const turn1 = turns[0]!;

    const page = makePage({
      evaluateText: "got it — i have noted that your favorite color is blue.",
    });

    await expect(turn1.assertions!(page)).resolves.toBeUndefined();
  });

  it("FAILS when response is unrelated (no color/blue mention)", async () => {
    const turns = buildTurns(CTX);
    const turn1 = turns[0]!;

    const page = makePage({
      evaluateText: "ok, what else would you like to discuss?",
    });

    await expect(turn1.assertions!(page)).rejects.toThrow(
      /did not mention color\/blue/i,
    );
  });

  it("FAILS when no assistant message text is found at all", async () => {
    const turns = buildTurns(CTX);
    const turn1 = turns[0]!;

    const page = makePage({ evaluateText: "" });

    await expect(turn1.assertions!(page)).rejects.toThrow(
      /no assistant message text found/i,
    );
  });
});

describe("d5-shared-state preNavigateRoute", () => {
  it("returns /demos/shared-state-read for shared-state-read", () => {
    expect(preNavigateRoute("shared-state-read")).toBe(
      "/demos/shared-state-read",
    );
  });

  it("returns /demos/shared-state-write for shared-state-write", () => {
    expect(preNavigateRoute("shared-state-write")).toBe(
      "/demos/shared-state-write",
    );
  });

  it("throws on an unsupported featureType (defensive guard)", () => {
    // Cast through unknown to bypass the closed-enum type — the guard
    // exists for runtime robustness against a future feature-type
    // rename, and the test exercises that runtime branch.
    expect(() =>
      (preNavigateRoute as (ft: string) => string)("agentic-chat"),
    ).toThrow(/unsupported featureType "agentic-chat"/);
  });
});
