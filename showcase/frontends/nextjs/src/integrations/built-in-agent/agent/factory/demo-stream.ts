// Shared TanStack-AI plumbing for every built-in-agent demo factory.
//
// Both exports fix a defect that was invisible under aimock and only showed
// up against a real model — see showcase/GOTCHAS.md ("aimock D6 can be GREEN
// while the demo is BROKEN against a real LLM").

import { maxIterations } from "@tanstack/ai";

/**
 * Agent-loop budget for every demo factory's `chat()` call.
 *
 * `@tanstack/ai`'s `chat()` defaults to `maxIterations(5)` when no
 * `agentLoopStrategy` is passed (verified in the pinned `@tanstack/ai@0.35.0`,
 * `src/activities/chat/index.ts`: `config.params.agentLoopStrategy ||
 * maxIterationsStrategy(5)`). One iteration is consumed per model turn, so a
 * demo that scripts a multi-call tool walk silently runs out of loop before it
 * finishes — the run just ends mid-plan with no error.
 *
 * That is exactly what broke `gen-ui-agent`: `GEN_UI_AGENT_PROMPT` scripts 7
 * `set_steps` calls (1 initial + in_progress/completed per step × 3) plus a
 * closing assistant message = 8 turns. The loop stopped after 5, leaving the
 * last step pinned at `status: "pending"` and emitting no narration, on every
 * single run. The `subagents` demo spends turns on delegation too, so it has
 * the same exposure.
 *
 * 25 is deliberately generous — several times the longest scripted walk, so
 * adding a step or a delegation hop to any demo does not silently truncate it
 * again — while still bounding a runaway loop (each iteration is a model
 * call). Raise it here, once, rather than per factory.
 */
export const DEMO_AGENT_LOOP_STRATEGY = maxIterations(25);

/**
 * Re-throw a TanStack `RUN_ERROR` chunk as an exception so the runtime turns
 * it into an AG-UI RUN_ERROR the client can surface.
 *
 * Every demo converter is a `for await` loop that forwards a whitelist of
 * chunk types and drops the rest. `RUN_ERROR` fell in "the rest" for all of
 * them except `reasoning-factory.ts`, so an upstream API rejection became a
 * clean, silent, empty run: `RUN_STARTED` → `RUN_FINISHED`, no events, no
 * console error, no error banner — the demo just sits there forever.
 *
 * That is how `declarative-json-render` shipped broken: its `modelOptions`
 * carried `text.format: { type: "json_object" }` while the JSON-only
 * directive lived in `systemPrompts`, which the OpenAI adapter sends as
 * `instructions` rather than `input`, so the API answered
 *   400 "Response input messages must contain the word 'json' in some form
 *        to use 'text.format' of type 'json_object'."
 * and the converter threw it away. Call this from every converter so the next
 * such rejection is loud.
 */
export function throwOnRunError(raw: {
  type?: unknown;
  message?: unknown;
}): void {
  if (raw?.type !== "RUN_ERROR") return;
  throw new Error(
    typeof raw.message === "string" ? raw.message : "TanStack AI run error",
  );
}
