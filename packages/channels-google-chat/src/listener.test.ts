import { describe, expect, it, vi } from "vitest";
import type { IngressSink } from "@copilotkit/channels-core";
import { normalizeEvent } from "./events.js";
import { InMemoryHistoryStore } from "./history-store.js";
import { routeEvent } from "./listener.js";
import {
  APP,
  addOnAdded,
  addOnClick,
  addOnMention,
  addOnQuickCommand,
  addOnSlash,
  legacyDm,
  legacyQuickCommand,
  legacyMention,
  legacySlash,
} from "./__fixtures__/events.js";

function fakeSink() {
  return {
    onTurn: vi.fn(),
    onInteraction: vi.fn(),
    onWelcome: vi.fn(),
    onCommand: vi.fn(),
    onThreadStarted: vi.fn(),
    onReaction: vi.fn(),
    onModalSubmit: vi.fn(),
    onModalClose: vi.fn(),
  } satisfies IngressSink;
}

async function route(body: unknown, botUserId?: string) {
  const sink = fakeSink();
  const history = new InMemoryHistoryStore();
  await routeEvent(normalizeEvent(body), { sink, history, botUserId });
  return { sink, history };
}

describe("routeEvent", () => {
  it("turns a space @-mention into a mentioned turn keyed by its thread", async () => {
    const { sink, history } = await route(legacyMention);
    expect(sink.onTurn).toHaveBeenCalledTimes(1);
    const turn = sink.onTurn.mock.calls[0]![0];
    expect(turn).toMatchObject({
      platform: "google-chat",
      conversationKey: "gchat:spaces/ROOM1/threads/T1",
      replyTarget: { space: "spaces/ROOM1", thread: "spaces/ROOM1/threads/T1" },
      userText: "what is 2+2?",
      eventId: "spaces/ROOM1/messages/M1",
      operation: {
        kind: "created",
        logicalMessageId: "spaces/ROOM1/messages/M1",
        mentioned: true,
      },
      actor: {
        id: "users/111",
        kind: "human",
        name: "Ada Lovelace",
        email: "ada@example.com",
      },
      identityContext: {
        tenant: { id: "spaces/ROOM1" },
        conversation: { kind: "space" },
        trigger: "message",
        event: { id: "spaces/ROOM1/messages/M1" },
      },
    });
    expect(await history.read(turn.conversationKey)).toMatchObject([
      { role: "user", content: "what is 2+2?" },
    ]);
  });

  it("routes the add-on envelope identically", async () => {
    const { sink } = await route(addOnMention);
    expect(sink.onTurn.mock.calls[0]![0]).toMatchObject({
      conversationKey: "gchat:spaces/ROOM1/threads/T1",
      userText: "hi",
      operation: { mentioned: true },
    });
  });

  it("keys a direct message by its space and replies without a thread", async () => {
    const { sink } = await route(legacyDm);
    expect(sink.onTurn.mock.calls[0]![0]).toMatchObject({
      conversationKey: "gchat:spaces/DM1",
      replyTarget: { space: "spaces/DM1" },
      operation: { mentioned: true },
      identityContext: { conversation: { kind: "direct" } },
    });
    expect(sink.onTurn.mock.calls[0]![0].replyTarget).not.toHaveProperty(
      "thread",
    );
  });

  it("matches the mention against botUserId when it is set", async () => {
    const { sink } = await route(legacyMention, "users/someone-else");
    expect(sink.onTurn.mock.calls[0]![0].operation.mentioned).toBe(false);
  });

  it("never answers a bot", async () => {
    const fromBot = {
      ...legacyMention,
      message: { ...legacyMention.message, sender: APP },
    };
    const { sink } = await route(fromBot);
    expect(sink.onTurn).not.toHaveBeenCalled();
  });

  it("routes a slash command in either envelope to onCommand", async () => {
    for (const body of [legacySlash, addOnSlash]) {
      const { sink } = await route(body);
      expect(sink.onTurn).not.toHaveBeenCalled();
      expect(sink.onCommand.mock.calls[0]![0]).toMatchObject({
        command: "summarize",
        conversationKey: "gchat:spaces/ROOM1/threads/T1",
        replyTarget: {
          space: "spaces/ROOM1",
          thread: "spaces/ROOM1/threads/T1",
        },
        actor: { id: "users/111" },
        platform: "google-chat",
      });
    }
    const { sink } = await route(legacySlash);
    expect(sink.onCommand.mock.calls[0]![0].text).toBe("last week");
  });

  it("routes a quick command with no message by its command ID", async () => {
    for (const body of [legacyQuickCommand, addOnQuickCommand]) {
      const { sink } = await route(body);
      expect(sink.onCommand.mock.calls[0]![0]).toMatchObject({
        command: "2",
        text: "",
        conversationKey: "gchat:spaces/ROOM1/threads/T1",
        replyTarget: {
          space: "spaces/ROOM1",
          thread: "spaces/ROOM1/threads/T1",
        },
        actor: { id: "users/111" },
      });
    }
  });

  it("welcomes the space when the app is added", async () => {
    const { sink } = await route(addOnAdded);
    expect(sink.onWelcome.mock.calls[0]![0]).toMatchObject({
      conversationKey: "gchat:spaces/DM1",
      replyTarget: { space: "spaces/DM1" },
      platform: "google-chat",
    });
  });

  it("routes a click to onInteraction", async () => {
    const { sink } = await route(addOnClick({ actionId: "ck:1", value: "1" }));
    expect(sink.onInteraction.mock.calls[0]![0]).toMatchObject({
      id: "ck:1",
      value: 1,
    });
  });
});
