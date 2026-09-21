/** Actual canonical LGP pills for agentic-chat; no typed substitute. */
import { registerD5Script } from "../helpers/d5-registry.js";
import { buildChatPlatformTurns } from "./_pill-contracts-chat-platform.js";

export function buildAgenticChatTurns() {
  return buildChatPlatformTurns("agentic-chat");
}

registerD5Script({
  featureTypes: ["agentic-chat"],
  fixtureFile: "agentic-chat.json",
  buildTurns: buildAgenticChatTurns,
});
