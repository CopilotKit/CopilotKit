import { describe, expect, it } from "vitest";

import { DEMO_AGENT_LOOP_STRATEGY, throwOnRunError } from "./demo-stream";
import { GEN_UI_AGENT_PROMPT } from "./demo-prompts";

/**
 * Both suites pin defects that were GREEN under aimock and only broke against a
 * real model, so neither is covered by the D5/D6 fixtures. See showcase/GOTCHAS.md.
 */

// The agent loop's state after `iterationCount` model turns.
function afterTurns(iterationCount: number) {
  return { iterationCount, messages: [], finishReason: null };
}

describe("DEMO_AGENT_LOOP_STRATEGY", () => {
  /**
   * `gen-ui-agent`'s prompt scripts a fixed tool walk over 3 steps: one
   * `set_steps` to publish the plan, then in_progress + completed per step,
   * then a closing assistant message. That is 8 model turns. `@tanstack/ai`'s
   * default budget is 5 iterations, which cut the walk off after step 2 on
   * every run and left the card pinned mid-plan.
   */
  const SCRIPTED_TURNS = 8;

  it("the prompt still scripts the 3-step walk this budget is sized for", () => {
    // If the step count changes, this test fails and the budget gets
    // re-derived deliberately.
    expect(GEN_UI_AGENT_PROMPT).toContain("exactly 3");
  });

  it("allows the full scripted gen-ui-agent walk", () => {
    for (let turn = 0; turn < SCRIPTED_TURNS; turn++) {
      expect(DEMO_AGENT_LOOP_STRATEGY(afterTurns(turn))).toBe(true);
    }
  });

  it("is generous well beyond it, but still bounded", () => {
    expect(DEMO_AGENT_LOOP_STRATEGY(afterTurns(SCRIPTED_TURNS * 2))).toBe(true);
    expect(DEMO_AGENT_LOOP_STRATEGY(afterTurns(10_000))).toBe(false);
  });
});

describe("throwOnRunError", () => {
  it("rethrows a RUN_ERROR with the upstream message", () => {
    // The verbatim rejection that made declarative-json-render render nothing.
    const message =
      "400 Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'.";
    expect(() => throwOnRunError({ type: "RUN_ERROR", message })).toThrow(
      message,
    );
  });

  it("falls back to a generic message when RUN_ERROR carries no message", () => {
    expect(() => throwOnRunError({ type: "RUN_ERROR" })).toThrow(
      "TanStack AI run error",
    );
    expect(() => throwOnRunError({ type: "RUN_ERROR", message: 42 })).toThrow(
      "TanStack AI run error",
    );
  });

  it("passes through every non-error chunk untouched", () => {
    for (const type of [
      "RUN_STARTED",
      "RUN_FINISHED",
      "TEXT_MESSAGE_CONTENT",
      "TOOL_CALL_START",
      "STEP_FINISHED",
      undefined,
    ]) {
      expect(() => throwOnRunError({ type })).not.toThrow();
    }
  });
});
