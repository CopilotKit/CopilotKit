/** Actual canonical LGP pills for threadid-frontend-tool-roundtrip; no typed substitute. */
import { registerD5Script } from "../helpers/d5-registry.js";
import { buildChatPlatformTurns } from "./_pill-contracts-chat-platform.js";

export function buildTurns() {
  return buildChatPlatformTurns("threadid-frontend-tool-roundtrip");
}

registerD5Script({
  featureTypes: ["threadid-frontend-tool-roundtrip"],
  fixtureFile: "threadid-frontend-tool-roundtrip.json",
  buildTurns: buildTurns,
});
