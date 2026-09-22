/** Actual canonical LGP pills for prebuilt-sidebar; no typed substitute. */
import { registerD5Script } from "../helpers/d5-registry.js";
import { buildChatPlatformTurns } from "./_pill-contracts-chat-platform.js";

export function buildTurns() {
  return buildChatPlatformTurns("prebuilt-sidebar");
}

registerD5Script({
  featureTypes: ["prebuilt-sidebar"],
  fixtureFile: "prebuilt-sidebar.json",
  buildTurns: buildTurns,
});
