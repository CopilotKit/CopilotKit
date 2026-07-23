import { describe, it, expect } from "vitest";
import type { AgentSubscriber } from "@ag-ui/client";
import { createChannel, FakeAgent } from "@copilotkit/channels-core";
import { teams } from "../adapter.js";
import { FakeTeamsConnector } from "../testing/fake-teams-connector.js";

/**
 * Proves the credential-free Teams channel runs standalone, end to end,
 * Model 1 (no Intelligence, no real creds, no runtime `ChannelRunner`):
 * `createChannel({ agent, adapters: [teams()] })` → inject a
 * `FakeTeamsConnector` via `teamsAdapter.ɵbindConnector` → `channel.start()`
 * → `conn.emitTurn(...)` flows through the REAL channels-core dispatch
 * (`sink.onTurn` → §2 `decideChannelResponse` → `thread.runAgent` → egress)
 * → the fake agent's reply is posted back through the SAME injected
 * `FakeTeamsConnector`.
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

/** A credential-free Teams channel wired to a fresh `FakeTeamsConnector`, not yet started. */
function setup(agent: FakeAgent) {
  const teamsAdapter = teams({});
  const connector = new FakeTeamsConnector();
  teamsAdapter.ɵbindConnector(connector);
  const channel = createChannel({ agent, adapters: [teamsAdapter] });
  return { channel, connector };
}

describe("Model 1 standalone: credential-free Teams via an injected connector", () => {
  it("a tagged shared channel message auto-runs the agent, and the reply posts through the FakeTeamsConnector", async () => {
    const agent = new FakeAgent([replyingWith("hi there")]);
    const { channel, connector } = setup(agent);
    await channel.start();

    await connector.emitTurn({
      conversationKey: "19:abc@thread.tacv2",
      replyTarget: { conversationKey: "19:abc@thread.tacv2", reference: {} },
      userText: "hi",
      conversationKind: "channel",
      mentioned: true,
    });

    expect(agent.runAgentCalls).toBe(1);
    expect(connector.calls.some((c) => c.op === "sendActivity")).toBe(true);
  });

  it("an untagged shared channel message with no onMessage handler is ignored — no run, no egress", async () => {
    const agent = new FakeAgent([replyingWith("should never post")]);
    const { channel, connector } = setup(agent);
    await channel.start();

    await connector.emitTurn({
      conversationKey: "19:abc@thread.tacv2",
      replyTarget: { conversationKey: "19:abc@thread.tacv2", reference: {} },
      userText: "just chatting",
      conversationKind: "channel",
      mentioned: false,
    });

    expect(agent.runAgentCalls).toBe(0);
    expect(connector.calls).toHaveLength(0);
  });

  it("a personal (1:1) chat auto-runs the agent (already directly addressed), reply posts through the FakeTeamsConnector", async () => {
    const agent = new FakeAgent([replyingWith("hello from DM")]);
    const { channel, connector } = setup(agent);
    await channel.start();

    await connector.emitTurn({
      conversationKey: "conv-1",
      replyTarget: { conversationKey: "conv-1", reference: {} },
      userText: "help",
      conversationKind: "direct_message",
    });

    expect(agent.runAgentCalls).toBe(1);
    expect(connector.calls.some((c) => c.op === "sendActivity")).toBe(true);
  });

  it("a matching onMention handler takes precedence — the agent is not auto-run", async () => {
    const agent = new FakeAgent([replyingWith("should never run")]);
    const { channel, connector } = setup(agent);
    let handled = 0;
    channel.onMention(() => {
      handled++;
    });
    await channel.start();

    await connector.emitTurn({
      conversationKey: "19:abc@thread.tacv2",
      replyTarget: { conversationKey: "19:abc@thread.tacv2", reference: {} },
      userText: "handle me",
      conversationKind: "channel",
      mentioned: true,
    });

    expect(handled).toBe(1);
    expect(agent.runAgentCalls).toBe(0);
    expect(connector.calls.some((c) => c.op === "sendActivity")).toBe(false);
  });
});
