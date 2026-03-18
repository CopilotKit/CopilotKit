import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import type { Message, ReasoningMessage } from "@ag-ui/core";
import CopilotChatReasoningMessage from "../CopilotChatReasoningMessage.vue";

describe("CopilotChatReasoningMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-18T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createReasoningMessage(content: string): ReasoningMessage {
    return {
      id: "reasoning-1",
      role: "reasoning",
      content,
    } as ReasoningMessage;
  }

  it("shows 'Thinking…' when streaming and latest", () => {
    const message = createReasoningMessage("Analyzing...");
    const wrapper = mount(CopilotChatReasoningMessage, {
      props: {
        message,
        messages: [message] as Message[],
        isRunning: true,
      },
    });

    expect(wrapper.text()).toContain("Thinking…");
  });

  it("switches to 'Thought for ...' when streaming ends", async () => {
    const message = createReasoningMessage("Analyzing...");
    const wrapper = mount(CopilotChatReasoningMessage, {
      props: {
        message,
        messages: [message] as Message[],
        isRunning: true,
      },
    });

    vi.advanceTimersByTime(2100);
    await wrapper.setProps({ isRunning: false });

    expect(wrapper.text()).toMatch(/Thought for/);
  });

  it("auto-collapses after streaming and can be expanded by click", async () => {
    const message = createReasoningMessage("Expandable content");
    const wrapper = mount(CopilotChatReasoningMessage, {
      props: {
        message,
        messages: [message] as Message[],
        isRunning: true,
      },
    });

    const headerButton = () => wrapper.get("button");

    expect(headerButton().attributes("aria-expanded")).toBe("true");

    await wrapper.setProps({ isRunning: false });
    expect(headerButton().attributes("aria-expanded")).toBe("false");

    await headerButton().trigger("click");
    expect(headerButton().attributes("aria-expanded")).toBe("true");
  });
});
