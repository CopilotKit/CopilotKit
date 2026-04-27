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
 * (langgraph-python) exposes the demo at `/demos/hitl-in-chat`, but
 * several legacy integrations (langgraph-fastapi, langgraph-typescript,
 * ms-agent-python, pydantic-ai, langroid, claude-sdk-typescript) only
 * expose `/demos/hitl/` — they declare the legacy `hitl` registry id
 * rather than the modern `hitl-in-chat` id. We branch on which demo
 * id triggered this featureType (via `D5RouteContext.demos`): if the
 * integration declares any of the modern in-chat ids
 * (`hitl-in-chat`, `hitl-in-chat-booking`, `gen-ui-interrupt`) we use
 * `/demos/hitl-in-chat`; if it ONLY declares the legacy `hitl` id we
 * use `/demos/hitl`. When the driver passes no demos context (tests,
 * e2e-parity without registry context) we keep the modern default —
 * that's the canonical reference path and matches every integration
 * that has been updated to the modern id set.
 *
 * Assertion: the follow-up assistant message references the booking.
 * "Alice" is the load-bearing token from the fixture — the
 * acknowledgement names the attendee, so missing "Alice" implies the
 * second-leg fixture didn't fire or the agent regressed on
 * continuation. We deliberately do NOT assert on the chosen slot label
 * because the slot list is integration-defined and may drift.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5RouteContext, D5Script } from "../helpers/d5-registry.js";
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

/**
 * Modern in-chat HITL registry ids — every integration that exposes
 * `/demos/hitl-in-chat` declares at least one of these in its
 * `feature-registry.json` entry. Source-of-truth mirror of the keys in
 * `helpers/d5-feature-mapping.ts` that map to the `hitl-text-input`
 * D5 type. Kept as a tuple (not imported from the mapping) so this
 * script stays decoupled — the mapping table is allowed to grow new
 * legacy ids without forcing this script to relink.
 */
const MODERN_IN_CHAT_DEMO_IDS = [
  "hitl-in-chat",
  "hitl-in-chat-booking",
  "gen-ui-interrupt",
] as const;

/**
 * Resolve the navigation route based on which registry demo ids the
 * integration declares. Exported for unit tests so the branching logic
 * can be exercised without booting the full driver pipeline.
 */
export function preNavigateRoute(
  _featureType: unknown,
  ctx?: D5RouteContext,
): string {
  const demos = ctx?.demos ?? [];
  if (demos.length === 0) {
    // No demos context (tests, e2e-parity without registry join, or a
    // service whose discovery record carried an empty `demos[]`).
    // Default to the modern reference path — every integration in the
    // current fleet either declares modern in-chat ids OR the legacy
    // `hitl` id, and the legacy branch only fires when we have proof
    // (an explicit `hitl` entry) that the legacy route is the right
    // one.
    return "/demos/hitl-in-chat";
  }
  const hasModern = demos.some((id) =>
    (MODERN_IN_CHAT_DEMO_IDS as readonly string[]).includes(id),
  );
  if (hasModern) return "/demos/hitl-in-chat";
  if (demos.includes("hitl")) return "/demos/hitl";
  // Demos present but none of the known hitl ids matched — fall back
  // to the modern reference path so a future registry id we haven't
  // taught this script about doesn't silently 404.
  return "/demos/hitl-in-chat";
}

const script: D5Script = {
  featureTypes: ["hitl-text-input"],
  fixtureFile: "hitl-text-input.json",
  preNavigateRoute,
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
