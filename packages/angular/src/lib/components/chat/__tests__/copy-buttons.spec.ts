import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotChatAssistantMessageCopyButton } from "../copilot-chat-assistant-message-buttons";
import { CopilotChatUserMessageCopyButton } from "../copilot-chat-user-message-buttons";

// Captured before any test fakes timers: the clipboard write settles across
// Zone.js and native promises, so the tests wait one real macrotask for it.
const realSetTimeout = globalThis.setTimeout;
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));

describe.each([
  ["user", CopilotChatUserMessageCopyButton],
  ["assistant", CopilotChatAssistantMessageCopyButton],
])("the %s copy button", (_name, CopyButton) => {
  let written: string[];

  beforeEach(() => {
    written = [];
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function create(content: string) {
    const fixture = TestBed.createComponent(CopyButton);
    fixture.componentRef.setInput("content", content);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it("keeps the check mark for two seconds after the latest copy", async () => {
    vi.useFakeTimers();
    const button = create("Hello");

    button.handleCopy();
    await settle();
    vi.advanceTimersByTime(1500);
    button.handleCopy();
    await settle();
    vi.advanceTimersByTime(1500);
    expect(button.copied()).toBe(true);
    vi.advanceTimersByTime(500);

    expect(button.copied()).toBe(false);
    expect(written).toEqual(["Hello", "Hello"]);
  });

  it("copies nothing without content", async () => {
    const button = create("");

    button.handleCopy();
    await settle();

    expect(written).toEqual([]);
    expect(button.copied()).toBe(false);
  });
});
