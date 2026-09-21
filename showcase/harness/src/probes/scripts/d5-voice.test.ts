import { describe, it, expect } from "vitest";
import { buildTurns } from "./d5-voice.js";
import { getD5Script } from "../helpers/d5-registry.js";
import {
  CHAT_PLATFORM_CONTRACTS,
  assertChatPlatformResult,
} from "./_pill-contracts-chat-platform.js";

describe("voice canonical functional contract", () => {
  it("registers the canonical builder", () => {
    expect(getD5Script("voice")?.buildTurns).toBe(buildTurns);
  });
  it("accounts for every authored control with an exact dispatch and assertion", () => {
    const turns = buildTurns();
    expect(turns).toHaveLength(1);
    expect(new Set(turns.map((turn) => turn.action?.id)).size).toBe(
      turns.length,
    );
    expect(turns.map((turn) => turn.action?.buttonName)).toEqual(
      CHAT_PLATFORM_CONTRACTS["voice"]!.map((item) => item.label),
    );
    for (const turn of turns) {
      expect(turn.input).toBe(turn.action?.expectedDispatchedPrompt);
      expect(turn.action?.kind).toBe("pill");
      expect(turn.skipFill).toBeUndefined();
      expect(turn.skipSend).toBeUndefined();
      expect(turn.assertions).toBeTypeOf("function");
    }
  });
  it("uses actual Send after the canonical sample populates the composer", () => {
    expect(buildTurns()[0]!.action?.submission).toEqual({
      kind: "composer",
      expectedComposerText: "What is the weather in Tokyo?",
      sendButtonName: "",
      sendButtonTestId: "copilot-send-button",
    });
    expect(() =>
      assertChatPlatformResult(
        "voice",
        "The weather in Tokyo is currently 22°C with partly cloudy skies and light easterly winds.",
      ),
    ).not.toThrow();
    expect(() =>
      assertChatPlatformResult("voice", "Tokyo is 18°C and partly cloudy."),
    ).toThrow();
    expect(() => assertChatPlatformResult("voice", "Tokyo weather")).toThrow();
  });
});

describe("contradictory canonical replies", () => {
  it("rejects the voice contradiction", () => {
    expect(() =>
      assertChatPlatformResult(
        "voice",
        "Tokyo is not 22\u00b0C or partly cloudy. It is 5\u00b0C and raining.",
      ),
    ).toThrow();
  });
});
