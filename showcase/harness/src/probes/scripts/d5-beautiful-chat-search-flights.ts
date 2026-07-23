/**
 * D5 — beautiful-chat / Search Flights.
 *
 * Single-turn probe asserting the A2UI fixed-schema FlightCard
 * surface (the render path PR #4668 fixed). Part of the
 * `beautiful-chat-*` family — see `_beautiful-chat-shared.ts` for
 * context.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn } from "../helpers/conversation-runner.js";
import {
  assertSearchFlights,
  preNavigateBeautifulChat,
} from "./_beautiful-chat-shared.js";

export function buildTurns(ctx: D5BuildContext): ConversationTurn[] {
  // Only hermes needs surface-mount completion here, and ONLY hermes. Unlike
  // the a2ui-fixed-schema demo (which renders via A2UI in EVERY integration —
  // hence its `a2ui-fixed-card` testid is universal and its probe swaps
  // unconditionally), beautiful-chat's FlightCard is A2UI-rendered ONLY on
  // hermes: the fixed flight schema is emitted through the middleware-injected
  // `render_a2ui` tool call, whose A2UI binder mounts the surface
  // progressively, so its bubble text never stabilises for the settle window
  // and the default text-stability conjunct times out with
  // `reason=text-unstable` BEFORE the FlightCard assertion runs (verified: the
  // cards paint correctly but the turn reds). Every OTHER integration renders
  // beautiful-chat's FlightCard NATIVELY, settles on text as it always has,
  // and does NOT emit the `beautiful-chat-flight-card` testid — so applying
  // `completeOnMount` to them would require a surface that never mounts and
  // red a previously-green turn. Hence this swap is scoped to hermes; the
  // run-finished + new-bubble conjuncts still apply so it stays a strict
  // superset for hermes.
  const completeOnMount =
    ctx.integrationSlug === "hermes"
      ? {
          completeOnMount: {
            testIds: ["beautiful-chat-flight-card"],
            minNewMounts: 1,
          },
        }
      : {};
  return [
    {
      input: "d5 beautiful-chat probe: search flights from SFO to JFK",
      assertions: assertSearchFlights,
      responseTimeoutMs: 60_000,
      ...completeOnMount,
    },
  ];
}

registerD5Script({
  featureTypes: ["beautiful-chat-search-flights"],
  fixtureFile: "beautiful-chat-search-flights.json",
  buildTurns,
  preNavigateRoute: preNavigateBeautifulChat,
});
