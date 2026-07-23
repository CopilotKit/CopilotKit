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
    },
  ];
}

registerD5Script({
  featureTypes: ["beautiful-chat-search-flights"],
  fixtureFile: "beautiful-chat-search-flights.json",
  buildTurns,
  preNavigateRoute: preNavigateBeautifulChat,
});
