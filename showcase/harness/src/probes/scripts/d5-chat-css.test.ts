import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildChatCssAssertion,
  validateChatCss,
  USER_BUBBLE_SELECTOR,
  ASSISTANT_BUBBLE_SELECTOR,
  type ChatCssProbeResult,
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

/** Build a HALCYON-shaped probe result. */
function halcyonProbe(
  overrides: Partial<ChatCssProbeResult> = {},
): ChatCssProbeResult {
  return {
    userBorderLeft: "rgb(196, 74, 31)",
    userFontFamily:
      '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    assistantFontFamily:
      '"Fraunces", "Source Serif Pro", ui-serif, Georgia, "Times New Roman", serif',
    userBackground: "rgba(0, 0, 0, 0)",
    assistantBackground: "rgba(0, 0, 0, 0)",
    ...overrides,
  };
}

/** Build a legacy-shaped probe result. */
function legacyProbe(
  overrides: Partial<ChatCssProbeResult> = {},
): ChatCssProbeResult {
  return {
    userBorderLeft: "rgb(255, 111, 165)",
    userFontFamily: '"Georgia", "Cambria", serif',
    assistantFontFamily:
      '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Consolas, monospace',
    userBackground:
      "linear-gradient(135deg, rgb(255, 0, 110) 0%, rgb(194, 24, 91) 100%)",
    assistantBackground: "rgb(253, 224, 71)",
    ...overrides,
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
    it("returns null when full HALCYON signals are present", () => {
      expect(validateChatCss(halcyonProbe())).toBeNull();
    });

    it("returns null when full legacy signals are present", () => {
      expect(validateChatCss(legacyProbe())).toBeNull();
    });

    it("returns null when HALCYON anchors are present even if legacy anchors are absent", () => {
      // The integration is on HALCYON: bg is transparent (no legacy
      // anchors), but ember + Mono + Fraunces all match.
      expect(validateChatCss(halcyonProbe())).toBeNull();
    });

    it("returns null when legacy anchors are present even if HALCYON anchors are absent", () => {
      // Legacy theme: no ember on user inner, no Fraunces on assistant.
      // Bg anchors carry the signal.
      expect(validateChatCss(legacyProbe())).toBeNull();
    });

    it("returns combined error when neither theme matches", () => {
      const err = validateChatCss({
        userBorderLeft: "rgb(0, 0, 0)",
        userFontFamily: "Arial, sans-serif",
        assistantFontFamily: "Arial, sans-serif",
        userBackground: "rgb(255, 255, 255)",
        assistantBackground: "rgb(255, 255, 255)",
      });
      expect(err).toMatch(/neither HALCYON nor legacy theme matched/);
      expect(err).toMatch(/halcyon:/);
      expect(err).toMatch(/legacy:/);
    });

    it("returns error when bubbles missing entirely", () => {
      const err = validateChatCss({
        userBorderLeft: null,
        userFontFamily: null,
        assistantFontFamily: null,
        userBackground: null,
        assistantBackground: null,
      });
      expect(err).toMatch(/neither HALCYON nor legacy theme matched/);
    });
  });

  it("assertion fails when assistant bubble selector never appears", async () => {
    const assertion = buildChatCssAssertion({ waitTimeoutMs: 50 });
    await expect(
      assertion(makePage(null, { throwOnWait: true })),
    ).rejects.toThrow(/assistant bubble selector/);
  });

  it("assertion succeeds when HALCYON computed styles match", async () => {
    const assertion = buildChatCssAssertion();
    await expect(assertion(makePage(halcyonProbe()))).resolves.toBeUndefined();
  });

  it("assertion succeeds when legacy computed styles match", async () => {
    const assertion = buildChatCssAssertion();
    await expect(assertion(makePage(legacyProbe()))).resolves.toBeUndefined();
  });
});
