import { describe, it, expect } from "vitest";
import { getD5Script, type D5BuildContext } from "../helpers/d5-registry.js";
import type { Page } from "../helpers/conversation-runner.js";
import {
  buildTurns,
  buildChatSlotsAssertion,
  CUSTOM_ASSISTANT_MESSAGE_SELECTOR,
} from "./d5-chat-slots.js";

const FIXTURE_USER_MESSAGE = "verify chat slots are wired";

function makePage(opts: { throwOnWait?: boolean } = {}): Page {
  return {
    async waitForSelector() {
      if (opts.throwOnWait)
        throw new Error("waitForSelector timeout (test fake)");
    },
    async fill() {},
    async press() {},
    async evaluate() {
      return undefined as never;
    },
  };
}

describe("d5-chat-slots script", () => {
  it("registers under featureType 'chat-slots' with the canonical fixture file", () => {
    const script = getD5Script("chat-slots");
    expect(script).toBeDefined();
    expect(script?.featureTypes).toEqual(["chat-slots"]);
    expect(script?.fixtureFile).toBe("chat-slots.json");
  });

  it("buildTurns produces one turn whose input matches the fixture verbatim", () => {
    const ctx: D5BuildContext = {
      integrationSlug: "langgraph-python",
      featureType: "chat-slots",
      baseUrl: "https://example.test",
    };
    const turns = buildTurns(ctx);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.input).toBe(FIXTURE_USER_MESSAGE);
    expect(typeof turns[0]!.assertions).toBe("function");
  });

  it("exposes the assistant-message SlotMarker selector for the slot probe", () => {
    expect(CUSTOM_ASSISTANT_MESSAGE_SELECTOR).toBe(
      '[data-slot-label="MessageView.AssistantMessage"]',
    );
  });

  it("assertion fails when the slot wrapper does not appear in DOM", async () => {
    const assertion = buildChatSlotsAssertion({ waitTimeoutMs: 50 });
    await expect(assertion(makePage({ throwOnWait: true }))).rejects.toThrow(
      /assistant-message SlotMarker/,
    );
  });

  it("assertion succeeds when the slot wrapper appears", async () => {
    const assertion = buildChatSlotsAssertion();
    await expect(assertion(makePage())).resolves.toBeUndefined();
  });
});
