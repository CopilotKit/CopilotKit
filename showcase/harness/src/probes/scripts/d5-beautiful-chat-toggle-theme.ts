import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn } from "../helpers/conversation-runner.js";
import {
  buildBeautifulRouteTurns,
  preNavigateBeautifulChat,
} from "./_beautiful-chat-shared.js";

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return buildBeautifulRouteTurns();
}
registerD5Script({
  featureTypes: ["beautiful-chat-toggle-theme"],
  fixtureFile: "beautiful-chat-toggle-theme.json",
  buildTurns,
  preNavigateRoute: preNavigateBeautifulChat,
});
