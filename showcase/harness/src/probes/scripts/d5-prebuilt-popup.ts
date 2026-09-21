/** Actual canonical LGP pills for prebuilt-popup; no typed substitute. */
import { registerD5Script } from "../helpers/d5-registry.js";
import { buildChatPlatformTurns } from "./_pill-contracts-chat-platform.js";

export function buildTurns() {
  return buildChatPlatformTurns("prebuilt-popup");
}

registerD5Script({
  featureTypes: ["prebuilt-popup"],
  fixtureFile: "prebuilt-popup.json",
  buildTurns: buildTurns,
});
