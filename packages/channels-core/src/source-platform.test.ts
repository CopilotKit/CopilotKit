import type { AgentSubscriber } from "@ag-ui/client";
import { z } from "zod";
import { expect, test, vi } from "vitest";
import { createChannel } from "./create-channel.js";
import { MemoryStore } from "./state/memory-store.js";
import type { ChannelToolContext } from "./tools.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";

test("an ingress source platform reaches the text thread and its tool context", async () => {
  const observed: {
    messagePlatform?: string;
    threadPlatform?: string;
    toolPlatform?: string;
    toolThreadPlatform?: string;
  } = {};
  const adapter = new FakeAdapter({ platform: "intelligence" });
  const agent = new FakeAgent([
    (subscriber: AgentSubscriber) => {
      subscriber.onToolCallEndEvent?.({
        event: { toolCallId: "tool-call-1" },
        toolCallName: "capture_platform",
        toolCallArgs: {},
      } as never);
      subscriber.onRunFinishedEvent?.({ event: {} } as never);
    },
    (subscriber: AgentSubscriber) => {
      subscriber.onRunFinishedEvent?.({ event: {} } as never);
    },
  ]);
  const channel = createChannel({
    adapters: [adapter],
    agent: () => agent,
    tools: [
      {
        name: "capture_platform",
        description: "Capture the handler platform",
        parameters: z.object({}),
        handler: (_args: Record<string, never>, ctx: ChannelToolContext) => {
          observed.toolPlatform = ctx.platform;
          observed.toolThreadPlatform = ctx.thread.platform;
          return "captured";
        },
      },
    ],
  });
  channel.onMessage(async ({ message, thread }) => {
    observed.messagePlatform = message.platform;
    observed.threadPlatform = thread.platform;
    await thread.runAgent();
  });
  await channel.ɵruntime.start();

  await adapter.getSink().onTurn({
    conversationKey: "conversation-1",
    replyTarget: {},
    userText: "hello",
    platform: "slack",
  });

  expect(observed).toEqual({
    messagePlatform: "slack",
    threadPlatform: "slack",
    toolPlatform: "slack",
    toolThreadPlatform: "slack",
  });
});

test("an ingress source platform scopes identity resolution and event dedupe", async () => {
  const state = new MemoryStore();
  const dedupeSeen = vi.spyOn(state.dedup, "seen").mockResolvedValue(false);
  const identity = vi.fn(() => "person-1");
  const adapter = new FakeAdapter({ platform: "intelligence" });
  const channel = createChannel({
    adapters: [adapter],
    store: {
      adapter: state,
      identity,
      transcripts: {},
    },
  });
  let userKey: string | undefined;
  channel.onMessage(({ message }) => {
    userKey = message.userKey;
  });
  await channel.ɵruntime.start();

  await adapter.getSink().onTurn({
    conversationKey: "conversation-1",
    replyTarget: {},
    userText: "hello",
    platform: "teams",
    eventId: "event-1",
    user: { id: "user-1" },
  });

  expect(dedupeSeen).toHaveBeenCalledWith(
    "message:teams:created:event-1:event-1",
    300_000,
  );
  expect(identity).toHaveBeenCalledWith(
    expect.objectContaining({
      adapter: "teams",
      message: expect.objectContaining({ platform: "teams" }),
    }),
  );
  expect(userKey).toBe("person-1");
});

test("non-text ingress keeps source platform in handler contexts and dedupe keys", async () => {
  const state = new MemoryStore();
  const dedupeSeen = vi.spyOn(state.dedup, "seen").mockResolvedValue(false);
  const adapter = new FakeAdapter({ platform: "intelligence" });
  const observed: Record<string, string> = {};
  const channel = createChannel({
    adapters: [adapter],
    store: { adapter: state },
  });
  channel.onCommand("triage", ({ platform, thread }) => {
    observed.commandPlatform = platform;
    observed.commandThreadPlatform = thread.platform;
  });
  channel.onInteraction("approve", ({ message, platform, thread }) => {
    observed.interactionMessagePlatform = message.platform;
    observed.interactionPlatform = platform;
    observed.interactionThreadPlatform = thread.platform;
  });
  channel.onReaction(({ thread }) => {
    observed.reactionThreadPlatform = thread.platform;
  });
  await channel.ɵruntime.start();
  const sink = adapter.getSink();

  await sink.onCommand({
    command: "triage",
    conversationKey: "command-conversation",
    eventId: "command-event",
    platform: "teams",
    replyTarget: {},
    text: "",
  });
  const interaction = {
    id: "approve",
    conversationKey: "interaction-conversation",
    eventId: "interaction-event",
    platform: "slack",
    replyTarget: {},
  };
  await sink.onInteraction(interaction);
  await sink.onReaction({
    added: true,
    conversationKey: "reaction-conversation",
    messageId: "message-1",
    platform: "teams",
    raw: {},
    rawEmoji: "👍",
    replyTarget: {},
  });

  expect(observed).toEqual({
    commandPlatform: "teams",
    commandThreadPlatform: "teams",
    interactionMessagePlatform: "slack",
    interactionPlatform: "slack",
    interactionThreadPlatform: "slack",
    reactionThreadPlatform: "teams",
  });
  expect(dedupeSeen).toHaveBeenCalledWith("evt:teams:command-event", 300_000);
  expect(dedupeSeen).toHaveBeenCalledWith(
    "evt:slack:interaction-event",
    300_000,
  );
});
