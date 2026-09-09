import { describe, expect, it } from "vitest";

import { DEMO_AGENT_LOOP_STRATEGY, throwOnRunError } from "./demo-stream";
import { GEN_UI_AGENT_PROMPT } from "./demo-prompts";

/**
 * Both suites pin defects that were GREEN under aimock and only broke against a
 * real model, so neither is covered by the D5/D6 fixtures. See showcase/GOTCHAS.md.
 */

describe("DEMO_AGENT_LOOP_STRATEGY", () => {
  /**
   * `gen-ui-agent`'s prompt scripts a fixed tool walk: one `set_steps` to
   * publish the plan, then in_progress + completed per step, then a closing
   * assistant message. `@tanstack/ai`'s default budget is 5 iterations, which
   * cut the walk off after step 2 on every run and left the card pinned mid-plan.
   * If someone lowers the budget below the scripted walk, that silent truncation
   * comes straight back — so derive the requirement from the prompt itself.
   */
  const STEPS_IN_PROMPT = 3;
  const REQUIRED_ITERATIONS = 1 + STEPS_IN_PROMPT * 2 + 1; // plan + 2/step + final message

  it("the prompt still scripts the walk this budget is sized for", () => {
    // Guards the arithmetic above against a prompt rewrite: if the step count
    // changes, this test fails and the budget gets re-derived deliberately.
    expect(GEN_UI_AGENT_PROMPT).toContain(`exactly ${STEPS_IN_PROMPT}`);
    expect(REQUIRED_ITERATIONS).toBe(8);
  });

  it("allows the full scripted gen-ui-agent walk", () => {
    for (let i = 0; i < REQUIRED_ITERATIONS; i++) {
      expect(
        DEMO_AGENT_LOOP_STRATEGY({
          iterationCount: i,
        } as unknown as Parameters<typeof DEMO_AGENT_LOOP_STRATEGY>[0]),
      ).toBe(true);
    }
  });

  it("is generous well beyond it, but still bounded", () => {
    expect(
      DEMO_AGENT_LOOP_STRATEGY({
        iterationCount: REQUIRED_ITERATIONS * 2,
      } as unknown as Parameters<typeof DEMO_AGENT_LOOP_STRATEGY>[0]),
    ).toBe(true);
    expect(
      DEMO_AGENT_LOOP_STRATEGY({
        iterationCount: 10_000,
      } as unknown as Parameters<typeof DEMO_AGENT_LOOP_STRATEGY>[0]),
    ).toBe(false);
  });

  it("would have rejected the default budget that caused the truncation", () => {
    // The regression itself: at iterationCount 5 the old default stopped.
    expect(REQUIRED_ITERATIONS).toBeGreaterThan(5);
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
