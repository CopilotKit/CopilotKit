/** Actual canonical LGP pills for multimodal; no typed substitute. */
import { registerD5Script } from "../helpers/d5-registry.js";
import { buildChatPlatformTurns } from "./_pill-contracts-chat-platform.js";

export function buildTurns() {
  return buildChatPlatformTurns("multimodal");
}

registerD5Script({
  featureTypes: ["multimodal"],
  fixtureFile: "multimodal.json",
  buildTurns: buildTurns,
});
