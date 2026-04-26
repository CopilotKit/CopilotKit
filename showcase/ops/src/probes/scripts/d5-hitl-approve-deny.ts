/**
 * D5 — `hitl-approve-deny` script.
 *
 * Drives the in-app approval HITL flow at `/demos/hitl-in-app` against
 * the langgraph-python reference (and any integration that registers
 * the same feature). Mirrors `showcase/ops/fixtures/d5/hitl-approve-deny.json`:
 *
 *   - User: "Issue a $50 refund to customer #12345"
 *   - Agent (first leg): tool-calls `request_user_approval`. Frontend
 *     opens a modal dialog (out of the chat surface).
 *   - Probe: clicks "Approve". Tool result resolves with
 *     `{ approved: true }`.
 *   - Agent (second leg): emits a one-sentence acknowledgement that
 *     references the approved action ("$50 refund to customer #12345").
 *
 * Why approve-only (no separate deny turn): the canonical fixture
 * matches `toolCallId` for the second leg with a fixed acknowledgement
 * — the same fixture would NOT cleanly distinguish an approve path from
 * a deny path because aimock matches by id, not by tool result. A
 * deny-path probe would need a second fixture variant; not in scope for
 * this script. The shared helper exposes both verbs so a future fixture
 * with a deny path can wire it up trivially.
 *
 * Route override: feature type `hitl-approve-deny` would default to
 * `/demos/hitl-approve-deny`, which doesn't exist. The reference
 * showcase exposes the demo at `/demos/hitl-in-app`.
 *
 * Assertion: the follow-up assistant message references the approved
 * action. We assert the response mentions the dollar amount AND the
 * customer id from the fixture, since those are the load-bearing
 * elements of the user's request — a generic "Done" without those
 * tokens would be a regression in the agent's continuation behaviour.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5Script } from "../helpers/d5-registry.js";
import {
  approveOrDeny,
  readAssistantCount,
  waitForNextAssistantMessage,
} from "./_hitl-shared.js";
import type { Page as HitlPage } from "./_hitl-shared.js";
import type { Page as ConversationPage } from "../helpers/conversation-runner.js";

/**
 * Assertion tokens — every successful continuation MUST include these
 * substrings. Pulled from the fixture's second-leg response content.
 * Substring match is intentional: the surrounding wording can drift but
 * the dollar amount and the customer id pin the assertion to the
 * specific approved action, not just "the agent said something".
 */
const REFERENCE_TOKENS = ["$50", "12345"] as const;

const script: D5Script = {
  featureTypes: ["hitl-approve-deny"],
  fixtureFile: "hitl-approve-deny.json",
  preNavigateRoute: () => "/demos/hitl-in-app",
  buildTurns: () => [
    {
      input: "Issue a $50 refund to customer #12345",
      // Generous timeout: the first leg waits for the agent to
      // tool-call AND the modal to render. The conversation-runner's
      // settle window measures assistant-message stability — the modal
      // appears as a side effect of the tool call landing in the
      // conversation, so settle fires once the assistant message
      // (which carries the toolCall) has streamed in.
      responseTimeoutMs: 60_000,
      assertions: async (page: ConversationPage) => {
        // Runtime guard: HitlPage extends ConversationPage with `click`,
        // and the ConversationPage interface deliberately omits DOM/click
        // semantics so the conversation-runner stays minimal. The cast
        // through `unknown` makes the structural widening explicit; we
        // back it with a typeof check so a fake page that forgets to
        // implement `click` fails loudly instead of silently no-opping.
        const hitlPage = page as unknown as HitlPage;
        if (typeof (hitlPage as { click?: unknown }).click !== "function") {
          throw new Error(
            "d5-hitl-approve-deny: page is missing click() — cannot drive HITL dialog",
          );
        }
        // Snapshot the assistant-message count BEFORE we click — the
        // click triggers the second LLM leg, which lands a NEW
        // assistant message. We poll for growth past this baseline.
        const baselineCount = await readAssistantCount(hitlPage);
        await approveOrDeny(hitlPage, "approve");
        const followup = await waitForNextAssistantMessage(
          hitlPage,
          baselineCount,
        );
        for (const token of REFERENCE_TOKENS) {
          if (!followup.includes(token)) {
            throw new Error(
              `assistant follow-up missing token "${token}" — got: ${followup.slice(0, 200)}`,
            );
          }
        }
      },
    },
  ],
};

registerD5Script(script);

// Exported for unit tests — they assert registration shape and exercise
// `buildTurns` directly without re-importing the module (which would
// double-register and throw).
export const __d5HitlApproveDenyScript = script;
