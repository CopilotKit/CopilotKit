import { describe, it, expect } from "vitest";
import type { AgentSubscriber } from "@ag-ui/client";
import { createChannel, FakeAgent } from "@copilotkit/channels-core";
import { telegram } from "../adapter.js";
import { FakeTelegramConnector } from "../testing/fake-telegram-connector.js";

/**
 * Proves the credential-free Telegram channel runs standalone, end to end,
 * Model 1 (no Intelligence, no real bot token, no runtime `ChannelRunner`):
 * `createChannel({ agent, adapters: [telegram()] })` → inject a
 * `FakeTelegramConnector` via `telegramAdapter.ɵbindConnector` →
 * `channel.start()` → `conn.emitTurn(...)` flows through the REAL
 * channels-core dispatch (`sink.onTurn` → legacy dispatch, since the
 * Telegram listener does not yet stamp §2's `conversationKind`/`mentioned` —
 * see the adapter-gut report) → the fake agent's reply is posted back
 * through the SAME injected `FakeTelegramConnector`.
 */

/** A FakeAgent script step that streams a short text reply, like a real agent would. */
function replyingWith(text: string) {
  return async (subscriber: AgentSubscriber): Promise<void> => {
    await subscriber.onTextMessageStartEvent?.({
      event: { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
    } as never);
    subscriber.onTextMessageContentEvent?.({
      event: { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: text },
      textMessageBuffer: "",
    } as never);
    await subscriber.onTextMessageEndEvent?.({
      event: { type: "TEXT_MESSAGE_END", messageId: "m1" },
    } as never);
    await subscriber.onRunFinishedEvent?.({
      event: { type: "RUN_FINISHED" },
    } as never);
  };
}

/** A credential-free Telegram channel wired to a fresh `FakeTelegramConnector`, not yet started. */
function setup(agent: FakeAgent) {
  const telegramAdapter = telegram({});
  const connector = new FakeTelegramConnector();
  telegramAdapter.ɵbindConnector(connector);
  const channel = createChannel({ agent, adapters: [telegramAdapter] });
  return { channel, connector };
}

describe("Model 1 standalone: credential-free Telegram via an injected connector", () => {
  it("a matching onMention handler runs (legacy dispatch: no conversationKind yet), reply posts through the FakeTelegramConnector", async () => {
    const agent = new FakeAgent([replyingWith("should never run directly")]);
    const { channel, connector } = setup(agent);
    let handled = 0;
    channel.onMention(async ({ thread }) => {
      handled++;
      await thread.runAgent();
    });
    await channel.start();

    await connector.emitTurn({
      conversationKey: "tg:9:dm",
      replyTarget: { chatId: 9, conversationKey: "tg:9:dm" },
      userText: "hi",
    });

    expect(handled).toBe(1);
    expect(agent.runAgentCalls).toBe(1);
    expect(connector.calls.some((c) => c.op === "sendMessage")).toBe(true);
  });

  it("with no mention/message handler registered, legacy dispatch is a no-op (no run, no egress)", async () => {
    const agent = new FakeAgent([replyingWith("should never post")]);
    const { channel, connector } = setup(agent);
    await channel.start();

    await connector.emitTurn({
      conversationKey: "tg:9:dm",
      replyTarget: { chatId: 9, conversationKey: "tg:9:dm" },
      userText: "hi",
    });

    expect(agent.runAgentCalls).toBe(0);
    expect(connector.calls).toHaveLength(0);
  });

  it("stop() delegates to the injected connector's stopIngress", async () => {
    const agent = new FakeAgent([replyingWith("n/a")]);
    const { channel, connector } = setup(agent);
    await channel.start();
    await channel.stop();

    expect(connector.ingressStopped).toBe(true);
  });
});
