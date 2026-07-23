/**
 * D5 — beautiful-chat / Pie Chart.
 *
 * Single-turn probe asserting the controlled-gen-UI `pieChart`
 * component renders. Part of the `beautiful-chat-*` family — see
 * `_beautiful-chat-shared.ts` for context.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn } from "../helpers/conversation-runner.js";
import {
  assertPieChart,
  preNavigateBeautifulChat,
} from "./_beautiful-chat-shared.js";

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input:
        "d5 beautiful-chat probe: pie chart of revenue distribution by category",
      assertions: assertPieChart,
    },
  ];
}

registerD5Script({
  featureTypes: ["beautiful-chat-pie-chart"],
  fixtureFile: "beautiful-chat-pie-chart.json",
  buildTurns,
  preNavigateRoute: preNavigateBeautifulChat,
});
