/**
 * D5 — `hitl-text-input` script.
 *
 * Drives the in-chat text-input HITL flow at `/demos/hitl-in-chat`
 * against the langgraph-python reference. Mirrors
 * `showcase/ops/fixtures/d5/hitl-text-input.json`:
 *
 *   - User: "Book a 30-minute onboarding call for Alice"
 *   - Agent (first leg): tool-calls `book_call` with topic + name. The
 *     frontend renders a `TimePickerCard` inline in the chat via
 *     `useHumanInTheLoop`.
 *   - Probe: picks the first available time slot. The card forwards
 *     `{ chosen_time, chosen_label }` back as the tool result.
 *   - Agent (second leg): emits a short acknowledgement that references
 *     the booking (e.g. "Booked Alice's onboarding call ...").
 *
 * Note on "text-input": the reference HITL UI for this feature in
 * langgraph-python is a slot-button picker, NOT a free-form text input.
 * The fixture's second-leg response is keyed on `toolCallId` regardless
 * of which slot is chosen, so picking the first available slot yields
 * the same assertion. A future port that uses a literal text input
 * (e.g. `<input type="text" /> + Submit`) will need a separate helper —
 * the shared cascade in `_hitl-shared.ts::pickTimeSlot` only covers the
 * button-grid case today.
 *
 * Route override: feature type `hitl-text-input` would default to
 * `/demos/hitl-text-input`, which doesn't exist. The reference showcase
 * exposes the demo at `/demos/hitl-in-chat`.
 *
 * Assertion: the follow-up assistant message references the booking.
 * "Alice" is the load-bearing token from the fixture — the
 * acknowledgement names the attendee, so missing "Alice" implies the
 * second-leg fixture didn't fire or the agent regressed on
 * continuation. We deliberately do NOT assert on the chosen slot label
 * because the slot list is integration-defined and may drift.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5Script } from "../helpers/d5-registry.js";
import {
  pickTimeSlot,
  readAssistantCount,
  waitForNextAssistantMessage,
} from "./_hitl-shared.js";
import type { Page as HitlPage } from "./_hitl-shared.js";
import type { Page as ConversationPage } from "../helpers/conversation-runner.js";

/**
 * Assertion tokens — pulled from the fixture's second-leg response. We
 * assert "Alice" only: it's the unique attendee in the fixture, and
 * any drift that drops the name signals a regression in agent
 * continuation. We avoid asserting on "Booked" because the
 * acknowledgement wording is closer to the model's discretion.
 */
const REFERENCE_TOKENS = ["Alice"] as const;

const script: D5Script = {
  featureTypes: ["hitl-text-input"],
  fixtureFile: "hitl-text-input.json",
  preNavigateRoute: () => "/demos/hitl-in-chat",
  buildTurns: () => [
    {
      input: "Book a 30-minute onboarding call for Alice",
      responseTimeoutMs: 60_000,
      assertions: async (page: ConversationPage) => {
        // Runtime guard: see d5-hitl-approve-deny for rationale.
        const hitlPage = page as unknown as HitlPage;
        if (typeof (hitlPage as { click?: unknown }).click !== "function") {
          throw new Error(
            "d5-hitl-text-input: page is missing click() — cannot drive HITL time-picker",
          );
        }
        const baselineCount = await readAssistantCount(hitlPage);
        await pickTimeSlot(hitlPage);
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

// Exported for unit tests — see d5-hitl-approve-deny.ts for rationale.
export const __d5HitlTextInputScript = script;
