/**
 * D5 — shared-state script.
 *
 * Owns BOTH `shared-state-read` and `shared-state-write` feature types.
 * The conversation exercises the agent-write half of bidirectional
 * shared state vs the LangGraph Python `shared_state_read_write`
 * agent: turn 1 the user asks the agent to remember something, the
 * agent calls the backend `set_notes` tool which mutates shared state
 * via `Command(update={'notes': ...})`. Turn 2 the user asks the agent
 * to recall what was remembered — the agent reads its own state and
 * replies. If the state didn't persist between turns, turn 2's
 * assertion fails. That assertion IS the invariant this probe enforces.
 *
 * Inputs are mirrored verbatim from `showcase/ops/fixtures/d5/shared-state.json`:
 *   - Turn 1: `remember that my favorite color is blue`
 *   - Turn 2: `What is my favorite color?` (substring `favorite color`
 *     matches the fixture's `userMessage` matcher; the matcher is
 *     prefix-loose so the question form is fine)
 *
 * Why both feature types in one script: the showcase splits the demo
 * into `/demos/shared-state-read` and `/demos/shared-state-write` but
 * the underlying LangGraph agent and fixture are shared. Running the
 * same conversation against each route covers the read+write contract
 * end-to-end without duplicating fixture wiring. The registry's
 * single-script / multi-feature-type shape exists for exactly this case.
 *
 * Route override: split by feature type. Read demo lives under
 * `/demos/shared-state-read`; write demo under `/demos/shared-state-write`.
 * Defaulting to `/demos/<featureType>` would already produce the right
 * paths today, but we set `preNavigateRoute` explicitly so this script
 * is the single source of truth for its route map and a future rename
 * of the demo folders won't silently mis-route via the driver default.
 */

import {
  registerD5Script,
  type D5BuildContext,
  type D5FeatureType,
} from "../helpers/d5-registry.js";
import {
  ASSISTANT_MESSAGE_FALLBACK_SELECTOR,
  ASSISTANT_MESSAGE_PRIMARY_SELECTOR,
  type ConversationTurn,
  type Page,
} from "../helpers/conversation-runner.js";

/**
 * Turn 1 user message — verbatim copy of the fixture's `userMessage`
 * match key. Any drift between this constant and the fixture means
 * showcase-aimock will fall through to a different fixture or no
 * fixture at all, and the probe fails opaquely. Keeping it as a
 * named export makes that coupling testable.
 */
export const TURN_1_INPUT = "remember that my favorite color is blue";

/**
 * Turn 2 user message — natural-language question form. The fixture's
 * `userMessage` matcher uses substring `favorite color`, so the
 * question is matched on the user-side and the assistant responds
 * with the canned recall response. The phrasing is intentionally
 * different from turn 1 to read like a normal conversation in the
 * dashboard transcript.
 */
export const TURN_2_INPUT = "What is my favorite color?";

/** Route map. Centralised so the unit test can verify it directly. */
export function preNavigateRoute(featureType: D5FeatureType): string {
  if (featureType === "shared-state-read") return "/demos/shared-state-read";
  if (featureType === "shared-state-write") return "/demos/shared-state-write";
  // Defensive: registry is closed-typed so callers can't reach this
  // branch through public API, but a future feature-type rename that
  // dropped one of the two would land here. Surface it loudly.
  throw new Error(
    `d5-shared-state: preNavigateRoute called with unsupported featureType "${featureType}"`,
  );
}

/**
 * Read the latest assistant message text from the page DOM. Uses the
 * canonical `[data-testid="copilot-assistant-message"]` selector with
 * `[role="article"]` fallback — same pair the conversation runner
 * uses for its message-count poll, so the assertion stays in lockstep
 * with what the runner considers an assistant message.
 *
 * Returns lowercased text so callers can `.includes(...)` on a stable
 * casing baseline. Returns `""` on read failure — the assertion's
 * `.includes(...)` will then fail with a clear message rather than
 * the assertion throwing on an unexpected null/undefined.
 */
async function readLatestAssistantText(page: Page): Promise<string> {
  // String-templated `new Function` lets us reference the shared
  // selector constants without dragging a `dom` lib dependency into the
  // helper module's tsconfig. JSON.stringify guarantees the embedded
  // selector strings are quoted correctly even if a future selector
  // contains awkward characters.
  const code = `
    (() => {
      const doc = globalThis.document;
      const canonical = doc.querySelectorAll(${JSON.stringify(
        ASSISTANT_MESSAGE_PRIMARY_SELECTOR,
      )});
      const list = canonical.length > 0
        ? canonical
        : doc.querySelectorAll(${JSON.stringify(
          ASSISTANT_MESSAGE_FALLBACK_SELECTOR,
        )});
      if (list.length === 0) return "";
      const last = list[list.length - 1];
      const text = (last && last.textContent) ? last.textContent : "";
      return text.toLowerCase();
    })()
  `;
  const fn = new Function(`return ${code};`) as () => string;
  return page.evaluate(fn);
}

/**
 * Build the two-turn conversation.
 *
 * Turn 1 assertion (relevance): the assistant response must mention
 * "color" or "blue". This is a soft signal — the canned fixture says
 * `Got it — I have noted that your favorite color is blue.` so both
 * substrings match. The check exists to catch a regression where the
 * tool call fired but no follow-up assistant message rendered (e.g.
 * the post-tool-result LLM leg silently failed) — without this
 * assertion the runner would see message-count growth from the tool
 * row alone and report green.
 *
 * Turn 2 assertion (THE invariant): the assistant must reply with
 * "blue" (case-insensitive). If shared state didn't persist between
 * turns the agent has no way to recall the color and this fails.
 * That's the entire point of the D5 shared-state probe.
 */
export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: TURN_1_INPUT,
      assertions: async (page: Page) => {
        const text = (await readLatestAssistantText(page)) ?? "";
        if (text.length === 0) {
          throw new Error(
            "turn 1: no assistant message text found after settle",
          );
        }
        // Either substring is acceptable — the canned fixture mentions
        // both, but a plausible alternate phrasing ("Noted, blue.")
        // would still satisfy "blue", and ("I'll remember that color")
        // would still satisfy "color".
        if (!text.includes("color") && !text.includes("blue")) {
          throw new Error(
            `turn 1: assistant response did not mention color/blue (got: ${truncate(text, 200)})`,
          );
        }
      },
    },
    {
      input: TURN_2_INPUT,
      assertions: async (page: Page) => {
        const text = (await readLatestAssistantText(page)) ?? "";
        if (text.length === 0) {
          throw new Error(
            "turn 2: no assistant message text found after settle",
          );
        }
        if (!text.includes("blue")) {
          throw new Error(
            `turn 2: assistant did not recall "blue" — shared state did not persist between turns (got: ${truncate(text, 200)})`,
          );
        }
      },
    },
  ];
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

// Side-effect registration. The dynamic loader in `e2e-deep.ts` imports
// this file at boot; importing it triggers this call which writes the
// script under both feature types in `D5_REGISTRY`.
registerD5Script({
  featureTypes: ["shared-state-read", "shared-state-write"],
  fixtureFile: "shared-state.json",
  buildTurns,
  preNavigateRoute,
});
