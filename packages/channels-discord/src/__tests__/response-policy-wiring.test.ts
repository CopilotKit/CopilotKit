import { describe, it, expect, vi } from "vitest";
import { decideChannelResponse } from "@copilotkit/channels-core";
import { attachDiscordListener } from "../discord-listener.js";
import type { IncomingTurn } from "../types.js";

/**
 * Proves the Discord ingress wiring (plan §2): every surface
 * `attachDiscordListener` emits carries the `conversationKind` + `mentioned`
 * the REAL `decideChannelResponse` (channels-core, already unit-tested there)
 * needs to make the correct ignore / handler / auto-run call. Mirrors
 * `channels-slack/src/__tests__/response-policy-wiring.test.ts`.
 */

const BOT_USER_ID = "bot-1";

function message(over: Record<string, unknown>) {
  return {
    author: { id: "u1", bot: false, username: "ann", globalName: "Ann" },
    content: "hello",
    channelId: "c1",
    guildId: "g1",
    mentions: { has: () => false, users: { has: () => false } },
    channel: { isDMBased: () => false },
    ...over,
  };
}

function setup() {
  let onMessageCreate: ((msg: Record<string, unknown>) => void) | undefined;
  const client = {
    on(event: string, cb: (arg: unknown) => void) {
      if (event === "messageCreate") onMessageCreate = cb as never;
    },
  };
  const turns: IncomingTurn[] = [];
  attachDiscordListener({
    client: client as never,
    botUserId: BOT_USER_ID,
    onTurn: (turn) => {
      turns.push(turn);
    },
    onCommand: vi.fn(),
  });
  return {
    turns,
    fireMessage: (m: Record<string, unknown>) => onMessageCreate?.(m),
  };
}

describe("Discord ingress → decideChannelResponse (§2 wiring proof)", () => {
  it("a tagged @-mention auto-runs with no handlers", () => {
    const f = setup();
    f.fireMessage(
      message({
        mentions: {
          has: () => true,
          users: { has: (id: string) => id === BOT_USER_ID },
        },
        content: `<@${BOT_USER_ID}> hello`,
      }),
    );
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

  it("an untagged guild channel message is ignored with no onMessage handler", () => {
    const f = setup();
    f.fireMessage(message({ content: "just talking" }));
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

  it("the SAME untagged message is handled once an onMessage handler is registered", () => {
    const f = setup();
    f.fireMessage(message({ content: "just talking" }));
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

  it("an untagged thread message is ignored with no handler, handled once onMessage opts in", () => {
    const f = setup();
    f.fireMessage(
      message({
        channel: { isDMBased: () => false, isThread: () => true },
        content: "carry on",
      }),
    );
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
    ).toEqual({
      action: "handler",
      handler: "message",
    });
  });

  it("a DM auto-runs regardless of handlers (already directly addressed)", () => {
    const f = setup();
    f.fireMessage(
      message({ channel: { isDMBased: () => true }, guildId: null }),
    );
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
