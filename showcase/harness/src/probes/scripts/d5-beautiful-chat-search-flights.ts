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

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "d5 beautiful-chat probe: search flights from SFO to JFK",
      assertions: assertSearchFlights,
      responseTimeoutMs: 60_000,
      // The FlightCard surface arrives via the A2UI render path. On the
      // hermes integration the fixed flight schema is emitted through the
      // middleware-injected `render_a2ui` tool call, and the surface bubble's
      // text never stabilises for the settle window (the A2UI binder mounts
      // the surface progressively), so the default text-stability settle
      // conjunct times out with `reason=text-unstable` BEFORE the FlightCard
      // assertion runs — even though the cards paint correctly. Opting into
      // `completeOnMount` swaps that third settle conjunct for "the FlightCard
      // mounted" (keyed on the `beautiful-chat-flight-card` testid the
      // FlightCard renderer emits in every integration's byte-identical
      // renderers.tsx). The run-finished + new-bubble conjuncts still apply,
      // so this is a strict superset: langgraph-python (backend search_flights
      // + trailing narration) still mounts the same testid and stays green,
      // and hermes' text-less render path now also completes. Mirrors the
      // identical swap in d5-gen-ui-a2ui-fixed.ts / d5-gen-ui-declarative.ts.
      completeOnMount: {
        testIds: ["beautiful-chat-flight-card"],
        minNewMounts: 1,
      },
    },
  ];
}

registerD5Script({
  featureTypes: ["beautiful-chat-search-flights"],
  fixtureFile: "beautiful-chat-search-flights.json",
  buildTurns,
  preNavigateRoute: preNavigateBeautifulChat,
});
