/**
 * D5 — beautiful-chat / Bar Chart.
 *
 * Single-turn probe asserting the controlled-gen-UI `barChart`
 * component renders (recharts container + bar rectangles). Part of
 * the `beautiful-chat-*` family — see `_beautiful-chat-shared.ts`
 * for context.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn } from "../helpers/conversation-runner.js";
import {
  assertBarChart,
  preNavigateBeautifulChat,
} from "./_beautiful-chat-shared.js";

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "d5 beautiful-chat probe: bar chart of expenses by category",
      assertions: assertBarChart,
    },
  ];
}

registerD5Script({
  featureTypes: ["beautiful-chat-bar-chart"],
  fixtureFile: "beautiful-chat-bar-chart.json",
  buildTurns,
  preNavigateRoute: preNavigateBeautifulChat,
});
