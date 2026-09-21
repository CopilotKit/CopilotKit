/** Actual canonical LGP pills for voice; no typed substitute. */
import { registerD5Script } from "../helpers/d5-registry.js";
import { buildChatPlatformTurns } from "./_pill-contracts-chat-platform.js";

export function buildTurns() {
  return buildChatPlatformTurns("voice");
}

registerD5Script({
  featureTypes: ["voice"],
  fixtureFile: "d5-all.json",
  buildTurns: buildTurns,
});
