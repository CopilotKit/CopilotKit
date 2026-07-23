import { describe, it, expect } from "vitest";
import type { AgentSubscriber } from "@ag-ui/client";
import { createChannel, FakeAgent } from "@copilotkit/channels-core";
import { discord } from "../adapter.js";
import { FakeDiscordConnector } from "../testing/fake-discord-connector.js";

/**
 * Proves the credential-free Discord channel runs standalone, end to end,
 * Model 1 (no Intelligence, no real creds, no runtime `ChannelRunner`):
 * `createChannel({ agent, adapters: [discord()] })` → inject a
 * `FakeDiscordConnector` via `discordAdapter.ɵbindConnector` →
 * `channel.start()` → `conn.emitTurn(...)` flows through the REAL
 * channels-core dispatch (`sink.onTurn` → §2 `decideChannelResponse` →
 * `thread.runAgent` → egress) → the fake agent's reply is posted back through
 * the SAME injected `FakeDiscordConnector`. Mirrors
 * `channels-slack/src/__tests__/model1-standalone.test.ts`.
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
  };
}

/** A credential-free Discord channel wired to a fresh `FakeDiscordConnector`, not yet started. */
function setup(agent: FakeAgent) {
  const discordAdapter = discord({});
  const connector = new FakeDiscordConnector();
  discordAdapter.ɵbindConnector(connector);
  const channel = createChannel({ agent, adapters: [discordAdapter] });
  return { channel, connector };
}

describe("Model 1 standalone: credential-free Discord via an injected connector", () => {
  it("a tagged message (@-mention) auto-runs the agent, and the reply posts through the FakeDiscordConnector", async () => {
    const agent = new FakeAgent([replyingWith("hi there")]);
    const { channel, connector } = setup(agent);
    await channel.ɵruntime.start();

    await connector.emitTurn({
      conversationKey: "c1",
      replyTarget: { channelId: "c1" },
      userText: "hi",
      conversationKind: "channel",
      mentioned: true,
    });

    expect(agent.runAgentCalls).toBe(1);
    expect(connector.calls.some((c) => c.op === "sendMessage")).toBe(true);
  });

  it("an untagged guild message with no onMessage handler is ignored — no run, no egress", async () => {
    const agent = new FakeAgent([replyingWith("should never post")]);
    const { channel, connector } = setup(agent);
    await channel.ɵruntime.start();

    await connector.emitTurn({
      conversationKey: "c2",
      replyTarget: { channelId: "c2" },
      userText: "just chatting",
      conversationKind: "channel",
      mentioned: false,
    });

    expect(agent.runAgentCalls).toBe(0);
    expect(connector.calls).toHaveLength(0);
  });

  it("a DM auto-runs the agent (already directly addressed), reply posts through the FakeDiscordConnector", async () => {
    const agent = new FakeAgent([replyingWith("hello from DM")]);
    const { channel, connector } = setup(agent);
    await channel.ɵruntime.start();

    await connector.emitTurn({
      conversationKey: "dm1",
      replyTarget: { channelId: "dm1" },
      userText: "help",
      conversationKind: "direct_message",
    });

    expect(agent.runAgentCalls).toBe(1);
    expect(connector.calls.some((c) => c.op === "sendMessage")).toBe(true);
  });

  it("a matching onMention handler takes precedence — the agent is not auto-run", async () => {
    const agent = new FakeAgent([replyingWith("should never run")]);
    const { channel, connector } = setup(agent);
    let handled = 0;
    channel.onMention(() => {
      handled++;
    });
    await channel.ɵruntime.start();

    await connector.emitTurn({
      conversationKey: "c3",
      replyTarget: { channelId: "c3" },
      userText: "handle me",
      conversationKind: "channel",
      mentioned: true,
    });

    expect(handled).toBe(1);
    expect(agent.runAgentCalls).toBe(0);
    expect(connector.calls.some((c) => c.op === "sendMessage")).toBe(false);
  });
});
