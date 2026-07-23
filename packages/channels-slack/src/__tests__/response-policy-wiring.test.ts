import { describe, it, expect, vi } from "vitest";
import { decideChannelResponse } from "@copilotkit/channels-core";
import { attachSlackListener } from "../slack-listener.js";
import type { IncomingTurn } from "../types.js";

/**
 * Proves the Slack ingress wiring (Task 3, plan §2): every surface the
 * listener/assistant emit carries the `conversationKind` + `mentioned` the
 * REAL `decideChannelResponse` (channels-core, already unit-tested there)
 * needs to make the correct ignore / handler / auto-run call. This is not a
 * re-test of `decideChannelResponse` itself — it proves the Slack-side
 * values feed it correctly, end to end from a raw Slack payload through to
 * the engine's decision.
 */

const BOT_USER_ID = "UBOT0001";

type EventHandler = (args: {
  event: Record<string, unknown>;
  client: object;
}) => unknown;
type MessageHandler = (args: {
  message: Record<string, unknown>;
  client: object;
}) => unknown;

function setup() {
  let mention: EventHandler | undefined;
  let message: MessageHandler | undefined;
  const app = {
    event(name: string, handler: EventHandler) {
      if (name === "app_mention") mention = handler;
    },
    message(handler: MessageHandler) {
      message = handler;
    },
    command() {},
  };
  const client = {};
  const turns: IncomingTurn[] = [];
  attachSlackListener({
    app: app as unknown as Parameters<typeof attachSlackListener>[0]["app"],
    botUserId: BOT_USER_ID,
    onTurn: (turn) => {
      turns.push(turn);
    },
    onCommand: vi.fn(),
  });
  return {
    turns,
    fireMention: (event: Record<string, unknown>) =>
      mention?.({ event, client }),
    fireMessage: (m: Record<string, unknown>) =>
      message?.({ message: m, client }),
  };
}

describe("Slack ingress → decideChannelResponse (§2 wiring proof)", () => {
  it("a tagged shared message (app_mention) auto-runs with no handlers", async () => {
    const f = setup();
    await f.fireMention({
      type: "app_mention",
      channel: "C1",
      ts: "100.0",
      text: `<@${BOT_USER_ID}> hello`,
    });
    const turn = f.turns[0]!;
    expect(
      decideChannelResponse({
        conversationKind: turn.conversationKind!,
        mentioned: turn.mentioned ?? false,
        hasMentionHandler: false,
        hasMessageHandler: false,
      }),
    ).toEqual({ action: "auto_run" });
  });

  it("an untagged shared top-level channel message is ignored with no onMessage handler", async () => {
    const f = setup();
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "U1",
      ts: "500.0",
      text: "just talking",
    });
    const turn = f.turns[0]!;
    expect(
      decideChannelResponse({
        conversationKind: turn.conversationKind!,
        mentioned: turn.mentioned ?? false,
        hasMentionHandler: false,
        hasMessageHandler: false,
      }),
    ).toEqual({ action: "ignore" });
  });

  it("the SAME untagged shared message is handled once an onMessage handler is registered", async () => {
    const f = setup();
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "U1",
      ts: "500.0",
      text: "just talking",
    });
    const turn = f.turns[0]!;
    expect(
      decideChannelResponse({
        conversationKind: turn.conversationKind!,
        mentioned: turn.mentioned ?? false,
        hasMentionHandler: false,
        hasMessageHandler: true,
      }),
    ).toEqual({ action: "handler", handler: "message" });
  });

  it("an untagged plain thread reply is ignored with no handler, handled once onMessage opts in", async () => {
    const f = setup();
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "U1",
      ts: "401.0",
      thread_ts: "400.0",
      text: "carry on",
    });
    const turn = f.turns[0]!;
    const input = {
      conversationKind: turn.conversationKind!,
      mentioned: turn.mentioned ?? false,
      hasMentionHandler: false,
    };
    expect(
      decideChannelResponse({ ...input, hasMessageHandler: false }),
    ).toEqual({ action: "ignore" });
    expect(
      decideChannelResponse({ ...input, hasMessageHandler: true }),
    ).toEqual({ action: "handler", handler: "message" });
  });

  it("a DM auto-runs regardless of handlers (already directly addressed)", async () => {
    const f = setup();
    await f.fireMessage({
      type: "message",
      channel: "D1",
      channel_type: "im",
      user: "U1",
      ts: "300.0",
      text: "hi bot",
    });
    const turn = f.turns[0]!;
    expect(
      decideChannelResponse({
        conversationKind: turn.conversationKind!,
        mentioned: turn.mentioned ?? false,
        hasMentionHandler: false,
        hasMessageHandler: false,
      }),
    ).toEqual({ action: "auto_run" });
  });
});
