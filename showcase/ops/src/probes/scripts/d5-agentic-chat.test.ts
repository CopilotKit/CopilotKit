import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  D5_REGISTRY,
  __clearD5RegistryForTesting,
  getD5Script,
} from "../helpers/d5-registry.js";
import type { D5Script } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";

/**
 * Unit tests for the agentic-chat D5 script.
 *
 * Registration is a one-shot module-level side effect: importing the
 * script file fires `registerD5Script(...)` exactly once into the
 * shared `D5_REGISTRY` map. We model this faithfully — clear the
 * registry in `beforeAll`, then import the script ONCE, then assert
 * across the resulting registry / turn shape / assertion behaviour.
 * Re-importing per test would either re-register (silent: cached
 * import) or require module-graph reset machinery that doesn't reflect
 * how the production driver actually loads scripts.
 *
 * Coverage:
 *  - Registration is a side-effect of importing the script module.
 *  - `buildTurns` returns exactly 3 turns whose `input` mirrors the
 *    fixture's `userMessage` substrings verbatim — required for
 *    aimock's first-match-wins routing.
 *  - Turn 3's assertion catches a missing-name response and accepts a
 *    present-name response (the actual context-retention check).
 *  - Turn 1's assertion catches an empty assistant response.
 */

interface FixtureFile {
  fixtures: Array<{
    match: { userMessage?: string };
    response: { content: string };
  }>;
}

function loadFixture(): FixtureFile {
  const here = fileURLToPath(import.meta.url);
  const fixturePath = path.resolve(
    path.dirname(here),
    "..",
    "..",
    "..",
    "fixtures",
    "d5",
    "agentic-chat.json",
  );
  return JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureFile;
}

function makePageReturning(text: string): Page {
  return {
    async waitForSelector() {
      // Not exercised by assertions.
    },
    async fill() {},
    async press() {},
    async evaluate<R>(_fn: () => R): Promise<R> {
      // The script's assertions read assistant text via `page.evaluate`.
      // The real `evaluate` fn walks the DOM and returns a *lowercased*
      // concatenated transcript (the lowercasing happens inside the
      // browser-context fn). Mirror that here so the substring check
      // sees what production sees: pre-lowercased text. Tests pass
      // mixed-case strings (e.g. "BUBBLES") to lock in case insensitivity
      // — they survive because both sides are lowercased before
      // comparison.
      return text.toLowerCase() as unknown as R;
    },
  };
}

describe("d5-agentic-chat script", () => {
  let script: D5Script;

  beforeAll(async () => {
    // Empty the registry so this suite's import is the *only* writer.
    // If a sibling test polluted it, the import below would throw on
    // double-registration — which would itself surface a real bug.
    __clearD5RegistryForTesting();
    // Static-style import via dynamic form. The .js extension matches
    // the rest of the package's NodeNext / bundler resolution style.
    await import("./d5-agentic-chat.js");
    const fetched = getD5Script("agentic-chat");
    if (!fetched) {
      throw new Error(
        "expected importing d5-agentic-chat.js to register an agentic-chat script",
      );
    }
    script = fetched;
  });

  it("registers itself for agentic-chat on import", () => {
    expect(script).toBeDefined();
    expect(script.fixtureFile).toBe("agentic-chat.json");
    expect(script.featureTypes).toEqual(["agentic-chat"]);
    expect(script.preNavigateRoute).toBeUndefined();
    // Registry only has the agentic-chat entry (this script claims a
    // single feature type).
    expect(D5_REGISTRY.size).toBe(1);
  });

  it("buildTurns returns 3 turns whose inputs contain the fixture substrings verbatim", () => {
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "agentic-chat",
      baseUrl: "https://example.test",
    });

    expect(turns).toHaveLength(3);

    // Each turn must include the fixture's `userMessage` substring
    // verbatim and case-sensitively — aimock's matcher is
    // `text.includes(match.userMessage)`. If this assertion ever
    // breaks, the showcase will hit the live LLM instead of the
    // canned fixture.
    const fixture = loadFixture();
    const matches = fixture.fixtures.map((f) => f.match.userMessage ?? "");
    expect(matches).toHaveLength(3);

    expect(turns[0]!.input).toContain(matches[0]!);
    expect(turns[1]!.input).toContain(matches[1]!);
    expect(turns[2]!.input).toContain(matches[2]!);

    // Cross-turn substring isolation: aimock first-match-wins on
    // substring match. If turn 2/3's input also contained turn 1's
    // fixture substring, every request would route to turn 1's
    // canned reply. Lock down the disjointness explicitly.
    expect(turns[1]!.input).not.toContain(matches[0]!);
    expect(turns[2]!.input).not.toContain(matches[0]!);
    expect(turns[2]!.input).not.toContain(matches[1]!);

    // Sanity: every turn carries an assertions callback. The driver
    // tolerates `undefined`, but a D5 script with no assertions is a
    // smell — it would only catch chrome-level failures (page didn't
    // load, chat input missing) and miss "assistant streamed empty".
    for (const turn of turns) {
      expect(typeof turn.assertions).toBe("function");
    }
  });

  it("turn-3 assertion catches a missing-name response", async () => {
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "agentic-chat",
      baseUrl: "https://example.test",
    });
    const turn3 = turns[2]!;

    // Assistant replied without recalling the goldfish's name. The
    // context-retention check must throw to surface this regression.
    const page = makePageReturning("I don't recall what we discussed earlier.");
    await expect(turn3.assertions!(page)).rejects.toThrow(/turn 3/);
  });

  it("turn-3 assertion passes a present-name response (case-insensitive)", async () => {
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "agentic-chat",
      baseUrl: "https://example.test",
    });
    const turn3 = turns[2]!;

    // Mixed case ("BUBBLES") to lock in case-insensitivity. The script
    // lowercases the transcript before comparing.
    const page = makePageReturning(
      "We named the goldfish BUBBLES, and the tank The Bubble Bowl.",
    );
    await expect(turn3.assertions!(page)).resolves.toBeUndefined();
  });

  it("turn-1 assertion fails on an empty assistant response", async () => {
    const turn1 = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "agentic-chat",
      baseUrl: "https://example.test",
    })[0]!;

    // Whitespace-only transcript — this is the common runtime-bug
    // signature the assertion is designed to surface.
    const page = makePageReturning("   ");
    await expect(turn1.assertions!(page)).rejects.toThrow(/turn 1/);
  });
});
