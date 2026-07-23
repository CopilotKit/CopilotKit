import { describe, it, expect } from "vitest";
import type { AgentSubscriber } from "@ag-ui/client";
import { createChannel, FakeAgent } from "@copilotkit/channels-core";
import { slack } from "../adapter.js";
import { FakeSlackConnector } from "../testing/fake-slack-connector.js";

/**
 * Task 3/T3s-4b — proves the credential-free Slack channel runs standalone,
 * end to end, Model 1 (no Intelligence, no real creds, no runtime
 * `ChannelRunner`): `createChannel({ agent, adapters: [slack()] })` →
 * inject a `FakeSlackConnector` via `slackAdapter.ɵbindConnector` →
 * `channel.start()` → `conn.emitTurn(...)` flows through the REAL
 * channels-core dispatch (`sink.onTurn` → §2 `decideChannelResponse` →
 * `thread.runAgent` → egress) → the fake agent's reply is posted back
 * through the SAME injected `FakeSlackConnector`.
 *
 * `assistant: false` + `streaming: "legacy"` keep egress on the simple
 * postMessage/updateMessage path — this proof is about the §2 dispatch
 * reaching a real Slack egress call, not Slack's native-streaming/pane
 * rendering nuances (covered elsewhere: event-renderer.test.ts,
 * native-stream.test.ts, assistant.test.ts).
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

/** A credential-free Slack channel wired to a fresh `FakeSlackConnector`, not yet started. */
function setup(agent: FakeAgent) {
  const slackAdapter = slack({ assistant: false, streaming: "legacy" });
  const connector = new FakeSlackConnector();
  slackAdapter.ɵbindConnector(connector);
  const channel = createChannel({ agent, adapters: [slackAdapter] });
  return { channel, connector };
}

describe("Model 1 standalone: credential-free Slack via an injected connector (Task 3)", () => {
  it("a tagged shared message auto-runs the agent, and the reply posts through the FakeSlackConnector", async () => {
    const agent = new FakeAgent([replyingWith("hi there")]);
    const { channel, connector } = setup(agent);
    await channel.start();

    await connector.emitTurn({
      conversationKey: "C1::100.000",
      replyTarget: { channel: "C1", threadTs: "100.000" },
      userText: "<@BOT> hi",
      conversationKind: "channel",
      mentioned: true,
    });

    expect(agent.runAgentCalls).toBe(1);
    expect(connector.calls.some((c) => c.op === "postMessage")).toBe(true);
  });

  it("an untagged shared message with no onMessage handler is ignored — no run, no egress", async () => {
    const agent = new FakeAgent([replyingWith("should never post")]);
    const { channel, connector } = setup(agent);
    await channel.start();

    await connector.emitTurn({
      conversationKey: "C1::200.000",
      replyTarget: { channel: "C1", threadTs: "200.000" },
      userText: "just chatting",
      conversationKind: "channel",
      mentioned: false,
    });

    expect(agent.runAgentCalls).toBe(0);
    expect(connector.calls).toHaveLength(0);
  });

  it("a DM auto-runs the agent (already directly addressed), reply posts through the FakeSlackConnector", async () => {
    const agent = new FakeAgent([replyingWith("hello from DM")]);
    const { channel, connector } = setup(agent);
    await channel.start();

    await connector.emitTurn({
      conversationKey: "D1",
      replyTarget: { channel: "D1" },
      userText: "help",
      conversationKind: "direct_message",
    });

    expect(agent.runAgentCalls).toBe(1);
    expect(connector.calls.some((c) => c.op === "postMessage")).toBe(true);
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
      conversationKey: "C1::300.000",
      replyTarget: { channel: "C1", threadTs: "300.000" },
      userText: "<@BOT> handle me",
      conversationKind: "channel",
      mentioned: true,
    });

    expect(handled).toBe(1);
    expect(agent.runAgentCalls).toBe(0);
    expect(connector.calls.some((c) => c.op === "postMessage")).toBe(false);
  });
});
