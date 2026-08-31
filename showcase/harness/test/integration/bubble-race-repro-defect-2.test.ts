import { describe, it, expect } from "vitest";
import { runBubbleRaceRepro } from "./bubble-race-repro.js";

/**
 * Phase 1 Task 1.2 — defect 2 (un-turn-scoped bubble selection).
 *
 * This file pairs the defect-RED test with a mechanism-GREEN test for
 * `messagesOverrideFromEnv()` (the Node-side helper in
 * `harness/src/probes/helpers/init-scripts.ts` consumed at the
 * `runConversation` callsite in `d6-all-pills.ts:1697`). The
 * mechanism-GREEN exists so a wiring regression of the override
 * channel surfaces immediately rather than masquerading as a
 * defect-2 failure. Per the user's tight-TDD-loop directive, the
 * mechanism test is asserted to PASS against the current state
 * (Phase-1 baseline at s4 commit 69b383d0c) before the defect-RED
 * test is permitted to run.
 *
 * Inputs use the canonical 3-turn sequence from
 * `aimock/d6/langgraph-python/agentic-chat.json`:
 *   1. "good name for a goldfish" -> response contains "Bubbles"
 *   2. "name for its tank"        -> response contains "Bubble Bowl"
 *   3. "what we named the goldfish" -> recall, response contains
 *      BOTH "Bubbles" AND "Bubble Bowl"
 *
 * Defect-2 manifests because `readLastAssistantText` in
 * `_gen-ui-shared.ts` reads `list[list.length - 1]` GLOBALLY (i.e.
 * the last bubble in the DOM at the moment of read), not the bubble
 * for the just-settled turn. On a 3-turn fixture with no mid-stream
 * cascade flicker, turn N's "last bubble" is the right one once
 * the COUNT settles, but the defect surfaces in two ways:
 *   (a) any cascade flicker between tiers mid-stream causes the
 *       "last" index to point at the wrong tier's list.
 *   (b) more importantly: turn N is supposed to read the bubble at
 *       INDEX N-1 (0-based), not the last index. The current
 *       implementation conflates "count grew past baseline" with
 *       "last bubble is mine"; under the new turn-indexed contract,
 *       a per-turn substring assertion will pin the correct read.
 *
 * Even on the happy path, turn-1's read can race the SSE stream
 * for turn-2 if the count-baseline settle window closes before
 * turn-2's bubble appears: turn-1's "last" suddenly becomes
 * turn-2's content. The substring assertion fails for the right
 * reason: turn 1 reads "Bubble Bowl" (turn-2's marker) instead of
 * "Bubbles" (turn-1's marker).
 */

describe("bubble-race repro (defect 2: mechanism-GREEN — messagesOverrideFromEnv)", () => {
  it("BUBBLE_RACE_MESSAGES drives the canonical 3-turn sequence through the harness end-to-end", async () => {
    const messages = [
      "good name for a goldfish",
      "name for its tank",
      "what we named the goldfish",
    ];
    const result = await runBubbleRaceRepro({
      slug: "langgraph-python:agentic-chat",
      level: "d5",
      messages,
    });
    expect(result.exitCode).toBe(0);
    // 3 settled turns means messagesOverrideFromEnv() got past the
    // env parse, became 3 ConversationTurns, was selected at the
    // override callsite, and each turn drove a settled assistant
    // response. This is the end-to-end wiring proof.
    expect(result.turns).toHaveLength(3);
    // Each of the 3 user inputs is represented by its character count in the
    // runner's privacy-safe
    // `[conversation-runner] turn N/total — sending message
    // metadata. This proves the override values reached the send channel
    // without copying prompt content into CI logs.
    expect(result.turns.map((turn) => turn.inputLength)).toEqual(
      messages.map((message) => message.length),
    );
  }, 240_000);
});

describe("bubble-race repro (defect 2: un-turn-scoped bubble selection)", () => {
  it("reads each turn's distinct text in order across the canonical 3-turn fixture", async () => {
    const result = await runBubbleRaceRepro({
      slug: "langgraph-python:agentic-chat",
      level: "d5",
      messages: [
        "good name for a goldfish",
        "name for its tank",
        "what we named the goldfish",
      ],
    });
    expect(result.exitCode).toBe(0);
    expect(result.turns).toHaveLength(3);
    // The canonical deterministic responses have distinct lengths. Pinning
    // their order still catches a global `list[last]` lookup while keeping
    // generated response content out of subprocess logs.
    const expectedResponses = [
      "How about Bubbles? It is friendly, classic, and easy to call out at the tank. If you want alternatives: Goldie, Finley, or Mango.",
      "Following the Bubbles theme, you could call the tank The Bubble Bowl. It pairs naturally with the goldfish's name and keeps the playful tone.",
      "We named the goldfish Bubbles, and the tank The Bubble Bowl.",
    ];
    expect(result.turns.map((turn) => turn.assistantTextLength)).toEqual(
      expectedResponses.map((response) => response.length),
    );
  }, 240_000);
});
