import { describe, it, expect } from "vitest";
import type { AgentSubscriber } from "@ag-ui/client";
import { createChannel, FakeAgent } from "@copilotkit/channels-core";
import { whatsapp } from "./adapter.js";
import { FakeWhatsAppConnector } from "./testing/fake-whatsapp-connector.js";

/**
 * Proves the credential-free WhatsApp channel runs standalone, end to end,
 * Model 1 (no Intelligence, no real creds, no runtime `ChannelRunner`):
 * `createChannel({ agent, adapters: [whatsapp()] })` → inject a
 * `FakeWhatsAppConnector` via `waAdapter.ɵbindConnector` → `channel.start()`
 * → `connector.emitTurn(...)` flows through the REAL channels-core dispatch
 * (`sink.onTurn` → §2 `decideChannelResponse` → `thread.runAgent` → egress) →
 * the fake agent's reply is posted back through the SAME injected
 * `FakeWhatsAppConnector`.
 *
 * WhatsApp is DM-only (plan §2: every turn is `conversationKind:
 * "direct_message"`), so — unlike Slack — there is no untagged/tagged split
 * to prove here: every inbound turn is already directly addressed and
 * auto-runs without a handler.
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

/** A credential-free WhatsApp channel wired to a fresh `FakeWhatsAppConnector`, not yet started. */
function setup(agent: FakeAgent) {
  const waAdapter = whatsapp({});
  const connector = new FakeWhatsAppConnector();
  waAdapter.ɵbindConnector(connector);
  const channel = createChannel({ agent, adapters: [waAdapter] });
  return { channel, connector };
}

describe("Model 1 standalone: credential-free WhatsApp via an injected connector", () => {
  it("a DM auto-runs the agent (already directly addressed), reply posts through the FakeWhatsAppConnector", async () => {
    const agent = new FakeAgent([replyingWith("hi there")]);
    const { channel, connector } = setup(agent);
    await channel.ɵruntime.start();

    await connector.emitTurn({
      conversationKey: "whatsapp:111",
      replyTarget: { to: "111", phoneNumberId: "PNID" },
      userText: "help",
    });

    expect(agent.runAgentCalls).toBe(1);
    expect(connector.calls.some((c) => c.op === "sendMessage")).toBe(true);
  });

  it("a matching onMessage handler takes precedence — the agent is not auto-run", async () => {
    const agent = new FakeAgent([replyingWith("should never run")]);
    const { channel, connector } = setup(agent);
    let handled = 0;
    channel.onMessage(() => {
      handled++;
    });
    await channel.ɵruntime.start();

    await connector.emitTurn({
      conversationKey: "whatsapp:222",
      replyTarget: { to: "222", phoneNumberId: "PNID" },
      userText: "handle me",
    });

    expect(handled).toBe(1);
    expect(agent.runAgentCalls).toBe(0);
    expect(connector.calls.some((c) => c.op === "sendMessage")).toBe(false);
  });
});
