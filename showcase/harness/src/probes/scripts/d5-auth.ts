/** Actual canonical LGP pills for auth; no typed substitute. */
import { registerD5Script } from "../helpers/d5-registry.js";
import { buildChatPlatformTurns } from "./_pill-contracts-chat-platform.js";

export function buildTurns() {
  return buildChatPlatformTurns("auth");
}

registerD5Script({
  featureTypes: ["auth"],
  fixtureFile: "auth.json",
  buildTurns: buildTurns,
});
