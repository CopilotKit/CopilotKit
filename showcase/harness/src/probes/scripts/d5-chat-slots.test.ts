import { describe, it, expect } from "vitest";
import { buildTurns } from "./d5-chat-slots.js";
import { getD5Script } from "../helpers/d5-registry.js";
import { CHAT_PLATFORM_CONTRACTS } from "./_pill-contracts-chat-platform.js";

describe("chat-slots canonical functional contract", () => {
  it("registers the canonical builder", () => {
    expect(getD5Script("chat-slots")?.buildTurns).toBe(buildTurns);
  });
  it("accounts for every authored control with an exact dispatch and assertion", () => {
    const turns = buildTurns();
    expect(turns).toHaveLength(2);
    expect(new Set(turns.map((turn) => turn.action?.id)).size).toBe(
      turns.length,
    );
    expect(turns.map((turn) => turn.action?.buttonName)).toEqual(
      CHAT_PLATFORM_CONTRACTS["chat-slots"]!.map((item) => item.label),
    );
    for (const turn of turns) {
      expect(turn.input).toBe(turn.action?.expectedDispatchedPrompt);
      expect(turn.action?.kind).toBe("pill");
      expect(turn.skipFill).toBeUndefined();
      expect(turn.skipSend).toBeUndefined();
      expect(turn.assertions).toBeTypeOf("function");
    }
  });
});
