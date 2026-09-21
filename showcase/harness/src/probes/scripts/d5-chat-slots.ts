/** Actual canonical LGP pills for chat-slots; no typed substitute. */
import { registerD5Script } from "../helpers/d5-registry.js";
import { buildChatPlatformTurns } from "./_pill-contracts-chat-platform.js";

export function buildTurns() {
  return buildChatPlatformTurns("chat-slots");
}

registerD5Script({
  featureTypes: ["chat-slots"],
  fixtureFile: "chat-slots.json",
  buildTurns: buildTurns,
});
