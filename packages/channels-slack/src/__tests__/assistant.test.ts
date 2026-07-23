import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Capture the `AssistantConfig` handed to `new Assistant(config)` so we can
 * drive its middleware (threadStarted / userMessage) directly with fake Bolt
 * utility args and assert what reaches the engine sink.
 */
interface CapturedConfig {
  threadStarted: (args: Record<string, unknown>) => Promise<void>;
  userMessage: (args: Record<string, unknown>) => Promise<void>;
  threadContextChanged?: (args: Record<string, unknown>) => Promise<void>;
}
let capturedConfig: CapturedConfig | undefined;

vi.mock("@slack/bolt", () => ({
  Assistant: class {
    config: CapturedConfig;
    constructor(config: CapturedConfig) {
      this.config = config;
      capturedConfig = config;
    }
  },
}));

import { attachAssistant } from "../assistant.js";
import type { IngressSink, PlatformUser } from "@copilotkit/channels-core";
import type { SlackAssistantOptions } from "../types.js";

function setup(opts: SlackAssistantOptions = {}) {
  capturedConfig = undefined;
  const onTurn = vi.fn(async () => {});
  const onThreadStarted = vi.fn(async () => {});
  const sink: IngressSink = {
    onTurn,
    onInteraction: vi.fn(),
    onCommand: vi.fn(),
    onThreadStarted,
    onReaction: vi.fn(),
    onModalSubmit: vi.fn(async () => {}),
    onModalClose: vi.fn(),
  };
  const resolveUser = vi.fn(
    async (id: string): Promise<PlatformUser> => ({ id, name: `name-${id}` }),
  );
  // The Bolt App is only used for `app.assistant(...)`, which our mocked
  // Assistant ignores — capture happens in the constructor above.
  const app = { assistant: vi.fn() } as never;
  const handle = attachAssistant({ app, sink, opts, resolveUser });
  return { handle, onTurn, onThreadStarted, resolveUser };
}

const threadStartedEvent = {
  event: {
    assistant_thread: {
      user_id: "U1",
      channel_id: "D1",
      thread_ts: "100.0",
    },
  },
};

describe("attachAssistant — threadStarted", () => {
  beforeEach(() => setup());

  it("applies static defaults (greeting + prompts) BEFORE emitting onThreadStarted", async () => {
    const { onThreadStarted } = setup({
      greeting: "hello!",
      suggestedPrompts: [{ title: "Triage", message: "Triage my issues" }],
    });
    const say = vi.fn(async () => {});
    const setSuggestedPrompts = vi.fn(async () => {});

    await capturedConfig!.threadStarted({
      ...threadStartedEvent,
      say,
      setSuggestedPrompts,
    });

    expect(say).toHaveBeenCalledWith("hello!");
    expect(setSuggestedPrompts).toHaveBeenCalledWith({
      prompts: [{ title: "Triage", message: "Triage my issues" }],
    });
    expect(onThreadStarted).toHaveBeenCalledTimes(1);
    // Ordering rule: defaults first, then the engine hook layers on top.
    expect(say.mock.invocationCallOrder[0]!).toBeLessThan(
      onThreadStarted.mock.invocationCallOrder[0]!,
    );
    expect(setSuggestedPrompts.mock.invocationCallOrder[0]!).toBeLessThan(
      onThreadStarted.mock.invocationCallOrder[0]!,
    );
  });

  it("emits onThreadStarted with a thread-scoped key and recipientUserId", async () => {
    const { onThreadStarted } = setup();
    await capturedConfig!.threadStarted({
      ...threadStartedEvent,
      say: vi.fn(),
      setSuggestedPrompts: vi.fn(),
    });
    expect(onThreadStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: "D1::100.0",
        replyTarget: {
          channel: "D1",
          threadTs: "100.0",
          recipientUserId: "U1",
        },
        user: { id: "U1", name: "name-U1" },
        platform: "slack",
      }),
    );
  });

  it("records the pane thread for the listener guard", async () => {
    const { handle } = setup();
    expect(handle.isAssistantThread("D1", "100.0")).toBe(false);
    await capturedConfig!.threadStarted({
      ...threadStartedEvent,
      say: vi.fn(),
      setSuggestedPrompts: vi.fn(),
    });
    expect(handle.isAssistantThread("D1", "100.0")).toBe(true);
    expect(handle.isAssistantThread("D1", "999.0")).toBe(false);
  });

  it("does not post a greeting or prompts when none are configured", async () => {
    const { onThreadStarted } = setup();
    const say = vi.fn(async () => {});
    const setSuggestedPrompts = vi.fn(async () => {});
    await capturedConfig!.threadStarted({
      ...threadStartedEvent,
      say,
      setSuggestedPrompts,
    });
    expect(say).not.toHaveBeenCalled();
    expect(setSuggestedPrompts).not.toHaveBeenCalled();
    expect(onThreadStarted).toHaveBeenCalledTimes(1);
  });
});

describe("attachAssistant — userMessage", () => {
  const msg = {
    message: { channel: "D1", thread_ts: "100.0", text: "hello", user: "U1" },
  };

  it("delivers exactly one turn scoped to the pane thread, with recipientUserId", async () => {
    const { onTurn } = setup();
    await capturedConfig!.userMessage({ ...msg, setTitle: vi.fn() });
    expect(onTurn).toHaveBeenCalledTimes(1);
    expect(onTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationKey: "D1::100.0",
        replyTarget: {
          channel: "D1",
          threadTs: "100.0",
          recipientUserId: "U1",
        },
        userText: "hello",
        platform: "slack",
      }),
    );
  });

  it("auto-titles from the FIRST user message only", async () => {
    const { onTurn } = setup(); // title defaults to "auto"
    const setTitle = vi.fn(async () => {});
    await capturedConfig!.userMessage({ ...msg, setTitle });
    await capturedConfig!.userMessage({
      message: { ...msg.message, text: "second message" },
      setTitle,
    });
    expect(setTitle).toHaveBeenCalledTimes(1);
    expect(setTitle).toHaveBeenCalledWith("hello");
    expect(onTurn).toHaveBeenCalledTimes(2);
  });

  it("never titles when title is disabled", async () => {
    setup({ title: false });
    const setTitle = vi.fn(async () => {});
    await capturedConfig!.userMessage({ ...msg, setTitle });
    expect(setTitle).not.toHaveBeenCalled();
  });

  it("ignores a message with no thread (not a pane message)", async () => {
    const { onTurn } = setup();
    await capturedConfig!.userMessage({
      message: { channel: "D1", text: "no thread", user: "U1" },
      setTitle: vi.fn(),
    });
    expect(onTurn).not.toHaveBeenCalled();
  });
});
