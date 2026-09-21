/** Actual canonical LGP pills for agent-config; no typed substitute. */
import { registerD5Script } from "../helpers/d5-registry.js";
import { buildChatPlatformTurns } from "./_pill-contracts-chat-platform.js";

export function buildTurns() {
  return buildChatPlatformTurns("agent-config");
}

registerD5Script({
  featureTypes: ["agent-config"],
  fixtureFile: "agent-config.json",
  buildTurns: buildTurns,
});
