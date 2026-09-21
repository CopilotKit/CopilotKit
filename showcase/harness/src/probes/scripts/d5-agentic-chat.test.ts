import { describe, it, expect } from "vitest";
import { buildAgenticChatTurns as buildTurns } from "./d5-agentic-chat.js";
import { getD5Script } from "../helpers/d5-registry.js";
import {
  CHAT_PLATFORM_CONTRACTS,
  assertChatPlatformResult,
} from "./_pill-contracts-chat-platform.js";

describe("agentic-chat canonical functional contract", () => {
  it("registers the canonical builder", () => {
    expect(getD5Script("agentic-chat")?.buildTurns).toBe(buildTurns);
  });
  it("accounts for every authored control with an exact dispatch and assertion", () => {
    const turns = buildTurns();
    expect(turns).toHaveLength(3);
    expect(new Set(turns.map((turn) => turn.action?.id)).size).toBe(
      turns.length,
    );
    expect(turns.map((turn) => turn.action?.buttonName)).toEqual(
      CHAT_PLATFORM_CONTRACTS["agentic-chat"]!.map((item) => item.label),
    );
    for (const turn of turns) {
      expect(turn.input).toBe(turn.action?.expectedDispatchedPrompt);
      expect(turn.action?.kind).toBe("pill");
      expect(turn.skipFill).toBeUndefined();
      expect(turn.skipSend).toBeUndefined();
      expect(turn.assertions).toBeTypeOf("function");
    }
  });
  it("keeps prime and creative result oracles explicitly unverified", () => {
    expect(() =>
      assertChatPlatformResult(
        "prime",
        "17 is prime. Its factors are 1 and 17.",
      ),
    ).toThrow(/not been established/);
    expect(() =>
      assertChatPlatformResult(
        "prime",
        "17 is not prime; factors are 1 and 17.",
      ),
    ).toThrow();
    expect(() =>
      assertChatPlatformResult("unestablished", "A nonempty reply"),
    ).toThrow(/not been established/);
  });
});

describe("contradictory canonical replies", () => {
  it("rejects the prime contradiction", () => {
    expect(() =>
      assertChatPlatformResult(
        "prime",
        "The claim that 17 is prime with divisors 1 and 17 is false; 17 is composite.",
      ),
    ).toThrow();
  });
});
