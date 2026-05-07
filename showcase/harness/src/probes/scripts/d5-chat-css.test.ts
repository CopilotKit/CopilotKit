import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildChatCssAssertion,
  validateChatCss,
  USER_BUBBLE_SELECTOR,
  ASSISTANT_BUBBLE_SELECTOR,
} from "./d5-chat-css.js";

function makePage(probe: unknown, opts: { throwOnWait?: boolean } = {}): Page {
  return {
    async waitForSelector() {
      if (opts.throwOnWait)
        throw new Error("waitForSelector timeout (test fake)");
    },
    async fill() {},
    async press() {},
    async evaluate() {
      return probe as never;
    },
  };
}

describe("d5-chat-css script", () => {
  it("registers under featureType 'chat-css' with the canonical fixture file", () => {
    const script = getD5Script("chat-css");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["chat-css"]);
    expect(script?.fixtureFile).toBe("chat-css.json");
  });

  it("buildTurns produces one turn whose input matches the fixture", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "chat-css",
      baseUrl: "https://example.test",
    };
    const turns = buildTurns(ctx);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.input).toBe("verify the css theme rendering");
  });

  it("exposes the bubble selectors", () => {
    expect(USER_BUBBLE_SELECTOR).toBe(
      ".copilotKitMessage.copilotKitUserMessage",
    );
    expect(ASSISTANT_BUBBLE_SELECTOR).toBe(
      ".copilotKitMessage.copilotKitAssistantMessage",
    );
  });

  describe("validateChatCss", () => {
    it("returns null when all halcyon signals are present", () => {
      expect(
        validateChatCss({
          userBorderLeft: "rgb(196, 74, 31)",
          userFontFamily:
            '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
          assistantFontFamily:
            '"Fraunces", "Source Serif Pro", ui-serif, Georgia, "Times New Roman", serif',
        }),
      ).toBeNull();
    });

    it("returns error when user bubble missing ember left border", () => {
      expect(
        validateChatCss({
          userBorderLeft: "rgb(0, 0, 0)",
          userFontFamily: "JetBrains Mono",
          assistantFontFamily: "Fraunces",
        }),
      ).toMatch(/halcyon-ember left border/);
    });

    it("returns error when user bubble missing halcyon-mono font", () => {
      expect(
        validateChatCss({
          userBorderLeft: "rgb(196, 74, 31)",
          userFontFamily: "Arial, sans-serif",
          assistantFontFamily: "Fraunces",
        }),
      ).toMatch(/halcyon-mono font/);
    });

    it("returns error when assistant bubble missing halcyon-serif font", () => {
      expect(
        validateChatCss({
          userBorderLeft: "rgb(196, 74, 31)",
          userFontFamily: "JetBrains Mono",
          assistantFontFamily: "Arial, sans-serif",
        }),
      ).toMatch(/halcyon-serif font/);
    });

    it("returns error when bubbles missing entirely", () => {
      expect(
        validateChatCss({
          userBorderLeft: null,
          userFontFamily: null,
          assistantFontFamily: null,
        }),
      ).toMatch(/user bubble inner.*not found/);
    });
  });

  it("assertion fails when assistant bubble selector never appears", async () => {
    const assertion = buildChatCssAssertion({ waitTimeoutMs: 50 });
    await expect(
      assertion(makePage(null, { throwOnWait: true })),
    ).rejects.toThrow(/assistant bubble selector/);
  });

  it("assertion succeeds when computed styles match", async () => {
    const assertion = buildChatCssAssertion();
    await expect(
      assertion(
        makePage({
          userBorderLeft: "rgb(196, 74, 31)",
          userFontFamily:
            '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
          assistantFontFamily:
            '"Fraunces", "Source Serif Pro", ui-serif, Georgia, "Times New Roman", serif',
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
