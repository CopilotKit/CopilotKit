import { describe, expect, it, vi } from "vitest";

import { populateChatInput } from "./showcase-chat-host-model";

describe("populateChatInput", () => {
  it("updates CopilotChat state instead of mutating only the textarea DOM", () => {
    const changeInput = vi.fn();

    expect(
      populateChatInput({ changeInput }, "What is the weather in Tokyo?"),
    ).toBe(true);
    expect(changeInput).toHaveBeenCalledWith("What is the weather in Tokyo?");
  });

  it("fails closed before the dynamic chat is available", () => {
    expect(populateChatInput(undefined, "queued too early")).toBe(false);
  });
});
