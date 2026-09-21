import { describe, it, expect } from "vitest";
import { buildTurns } from "./d5-multimodal.js";
import { getD5Script } from "../helpers/d5-registry.js";
import {
  CHAT_PLATFORM_CONTRACTS,
  assertChatPlatformResult,
} from "./_pill-contracts-chat-platform.js";

describe("multimodal canonical functional contract", () => {
  it("registers the canonical builder", () => {
    expect(getD5Script("multimodal")?.buildTurns).toBe(buildTurns);
  });
  it("accounts for every authored control with an exact dispatch and assertion", () => {
    const turns = buildTurns();
    expect(turns).toHaveLength(2);
    expect(new Set(turns.map((turn) => turn.action?.id)).size).toBe(
      turns.length,
    );
    expect(turns.map((turn) => turn.action?.buttonName)).toEqual(
      CHAT_PLATFORM_CONTRACTS["multimodal"]!.map((item) => item.label),
    );
    for (const turn of turns) {
      expect(turn.input).toBe(turn.action?.expectedDispatchedPrompt);
      expect(turn.action?.kind).toBe("pill");
      expect(turn.skipFill).toBeUndefined();
      expect(turn.skipSend).toBeUndefined();
      expect(turn.assertions).toBeTypeOf("function");
    }
  });
  it("requires the actual attachment asset descriptions", () => {
    expect(() =>
      assertChatPlatformResult(
        "image",
        "The attached image is the CopilotKit logo — a clean, geometric mark used across CopilotKit branding.",
      ),
    ).not.toThrow();
    expect(() => assertChatPlatformResult("image", "A nice image.")).toThrow();
    expect(() =>
      assertChatPlatformResult(
        "pdf",
        "The attached PDF document is the CopilotKit Quickstart guide. It walks through installing the React packages, configuring the CopilotKit provider, and adding a CopilotKit chat component to an application.",
      ),
    ).not.toThrow();
    expect(() =>
      assertChatPlatformResult("pdf", "CopilotKit Quickstart"),
    ).toThrow();
  });
});

describe("contradictory canonical replies", () => {
  it("rejects the image contradiction", () => {
    expect(() =>
      assertChatPlatformResult(
        "image",
        "This is not the CopilotKit logo; it is a photograph of a cat.",
      ),
    ).toThrow();
  });
  it("rejects the pdf contradiction", () => {
    expect(() =>
      assertChatPlatformResult(
        "pdf",
        "This is not the CopilotKit Quickstart; it says nothing about installing React packages, configuring the CopilotKit provider, or adding a CopilotKit chat component.",
      ),
    ).toThrow();
  });
});
