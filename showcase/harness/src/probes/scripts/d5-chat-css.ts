/** Actual canonical LGP pills for chat-css; no typed substitute. */
import { registerD5Script } from "../helpers/d5-registry.js";
import { buildChatPlatformTurns } from "./_pill-contracts-chat-platform.js";

export function buildTurns() {
  return buildChatPlatformTurns("chat-css");
}

registerD5Script({
  featureTypes: ["chat-css"],
  fixtureFile: "chat-css.json",
  buildTurns: buildTurns,
  preNavigateRoute: () => "/demos/chat-customization-css",
});
