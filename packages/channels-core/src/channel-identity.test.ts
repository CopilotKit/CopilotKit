import type { AgentSubscriber } from "@ag-ui/client";
import { expect, test, vi } from "vitest";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";

test("a Channel rejects construction without an explicit identity strategy", () => {
  expect(() =>
    createChannel({ adapters: [new FakeAdapter()] } as unknown as Parameters<
      typeof createChannel
    >[0]),
  ).toThrow('createChannel: `identifyUser` must be "platform" or a callback');
});

test("a custom Channel identity callback maps the provider actor once before the message handler", async () => {
  const identifyUser = vi.fn(() => ({ id: "person-1", name: "Pat Lee" }));
  const adapter = new FakeAdapter({ platform: "intelligence" });
  const channel = createChannel({
    adapters: [adapter],
    identifyUser,
  } as unknown as Parameters<typeof createChannel>[0]);
  let received: unknown;
  channel.onMessage(({ message }) => {
    received = message;
  });
  await channel.ɵruntime.start();

  await adapter.getSink().onTurn({
    conversationKey: "conversation-1",
    replyTarget: {},
    userText: "hello",
    platform: "slack",
    actor: {
      id: "U123",
      kind: "human",
      name: "Pat on Slack",
      handle: "pat",
    },
    identityContext: {
      tenant: { id: "T123", name: "Acme" },
      installation: { id: "I123" },
      conversation: { id: "C123", kind: "channel" },
      trigger: "message",
      event: { id: "E123", occurredAt: "2026-07-31T12:00:00.000Z" },
      raw: { type: "app_mention" },
    },
  } as unknown as Parameters<ReturnType<FakeAdapter["getSink"]>["onTurn"]>[0]);

  expect(identifyUser).toHaveBeenCalledTimes(1);
  expect(identifyUser).toHaveBeenCalledWith({
    provider: "slack",
    tenant: { id: "T123", name: "Acme" },
    installation: { id: "I123" },
    actor: {
      id: "U123",
      kind: "human",
      name: "Pat on Slack",
      handle: "pat",
    },
    conversation: { id: "C123", kind: "channel" },
    trigger: "message",
    event: { id: "E123", occurredAt: "2026-07-31T12:00:00.000Z" },
    raw: { type: "app_mention" },
  });
  expect(received).toEqual(
    expect.objectContaining({
      user: { id: "person-1", name: "Pat Lee" },
      actor: {
        id: "U123",
        kind: "human",
        name: "Pat on Slack",
        handle: "pat",
      },
    }),
  );
  expect(Object.isFrozen((received as { user: unknown }).user)).toBe(true);
  expect(Object.isFrozen((received as { actor: unknown }).actor)).toBe(true);
});

test("a command resolves identity once and exposes the canonical user and provider actor", async () => {
  const identifyUser = vi.fn(() => ({ id: "person-2", name: "Jo Kim" }));
  const adapter = new FakeAdapter({ platform: "intelligence" });
  const channel = createChannel({
    adapters: [adapter],
    identifyUser,
  } as unknown as Parameters<typeof createChannel>[0]);
  let received: unknown;
  channel.onCommand("who", (context) => {
    received = context;
  });
  await channel.ɵruntime.start();

  await adapter.getSink().onCommand({
    command: "who",
    conversationKey: "conversation-2",
    replyTarget: {},
    text: "",
    platform: "teams",
    actor: { id: "29:actor", kind: "human", name: "Jo on Teams" },
    identityContext: {
      tenant: { id: "tenant-2" },
      installation: { id: "install-2" },
      conversation: { id: "conversation-2", kind: "channel" },
      trigger: "command",
      event: { id: "event-2" },
      raw: { name: "who" },
    },
  } as unknown as Parameters<
    ReturnType<FakeAdapter["getSink"]>["onCommand"]
  >[0]);

  expect(identifyUser).toHaveBeenCalledTimes(1);
  expect(received).toEqual(
    expect.objectContaining({
      user: { id: "person-2", name: "Jo Kim" },
      actor: { id: "29:actor", kind: "human", name: "Jo on Teams" },
    }),
  );
});

test("an agent interrupt handler receives the event's canonical user and provider actor", async () => {
  const identifyUser = vi.fn(() => ({ id: "person-3", name: "Sam Rao" }));
  const adapter = new FakeAdapter({ platform: "intelligence" });
  const agent = new FakeAgent([
    (subscriber: AgentSubscriber) => {
      subscriber.onCustomEvent?.({
        event: { name: "approval", value: { requestId: "request-1" } },
      } as never);
      subscriber.onRunFinishedEvent?.({ event: {} } as never);
    },
  ]);
  const channel = createChannel({
    adapters: [adapter],
    identifyUser,
    agent,
  } as unknown as Parameters<typeof createChannel>[0]);
  let received: unknown;
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent();
  });
  channel.onInterrupt("approval", (context) => {
    received = context;
  });
  await channel.ɵruntime.start();

  await adapter.getSink().onTurn({
    conversationKey: "conversation-3",
    replyTarget: {},
    userText: "approve",
    platform: "slack",
    actor: { id: "U3", kind: "human", name: "Sam on Slack" },
    identityContext: {
      tenant: { id: "T3" },
      installation: { id: "I3" },
      conversation: { id: "C3", kind: "channel" },
      trigger: "message",
      event: { id: "E3" },
      raw: {},
    },
  } as never);

  expect(identifyUser).toHaveBeenCalledTimes(1);
  expect(received).toEqual(
    expect.objectContaining({
      payload: { requestId: "request-1" },
      user: { id: "person-3", name: "Sam Rao" },
      actor: { id: "U3", kind: "human", name: "Sam on Slack" },
    }),
  );
});

test("every non-message Channel trigger resolves identity once before its handler", async () => {
  const identifyUser = vi.fn(({ actor }: { actor: { id: string } }) => ({
    id: `person:${actor.id}`,
    name: actor.id,
  }));
  const adapter = new FakeAdapter({ platform: "intelligence" });
  const channel = createChannel({
    adapters: [adapter],
    identifyUser,
  } as unknown as Parameters<typeof createChannel>[0]);
  const received: unknown[] = [];
  channel.onThreadStarted((context) => {
    received.push(context);
  });
  channel.onInteraction("approve", (context) => {
    received.push(context);
  });
  channel.onReaction((context) => {
    received.push(context);
  });
  channel.onModalSubmit("submit", (context) => {
    received.push(context);
  });
  channel.onModalClose("close", (context) => {
    received.push(context);
  });
  await channel.ɵruntime.start();
  const sink = adapter.getSink();
  const facts = (id: string, trigger: string) => ({
    actor: { id, kind: "human" as const },
    identityContext: {
      tenant: { id: "tenant" },
      installation: { id: "installation" },
      conversation: { id: "conversation", kind: "channel" },
      trigger,
      event: { id: `event:${id}` },
      raw: { trigger },
    },
  });

  await sink.onThreadStarted({
    conversationKey: "conversation",
    replyTarget: {},
    platform: "slack",
    ...facts("thread-actor", "thread-start"),
  } as never);
  await sink.onInteraction({
    id: "approve",
    conversationKey: "conversation",
    replyTarget: {},
    platform: "slack",
    ...facts("interaction-actor", "interaction"),
  } as never);
  await sink.onReaction({
    added: true,
    conversationKey: "conversation",
    messageId: "message",
    raw: {},
    rawEmoji: "+1",
    replyTarget: {},
    platform: "slack",
    ...facts("reaction-actor", "reaction"),
  } as never);
  await sink.onModalSubmit({
    callbackId: "submit",
    values: {},
    conversationKey: "conversation",
    replyTarget: {},
    platform: "slack",
    raw: {},
    ...facts("submit-actor", "modal-submit"),
  } as never);
  await sink.onModalClose({
    callbackId: "close",
    conversationKey: "conversation",
    replyTarget: {},
    platform: "slack",
    raw: {},
    ...facts("close-actor", "modal-close"),
  } as never);

  expect(identifyUser).toHaveBeenCalledTimes(5);
  expect(received).toHaveLength(5);
  expect(received).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        user: { id: "person:thread-actor", name: "thread-actor" },
        actor: { id: "thread-actor", kind: "human" },
      }),
      expect.objectContaining({
        user: { id: "person:interaction-actor", name: "interaction-actor" },
        actor: { id: "interaction-actor", kind: "human" },
      }),
      expect.objectContaining({
        user: { id: "person:reaction-actor", name: "reaction-actor" },
        actor: { id: "reaction-actor", kind: "human" },
      }),
      expect.objectContaining({
        user: { id: "person:submit-actor", name: "submit-actor" },
        actor: { id: "submit-actor", kind: "human" },
      }),
      expect.objectContaining({
        user: { id: "person:close-actor", name: "close-actor" },
        actor: { id: "close-actor", kind: "human" },
      }),
    ]),
  );
});

test("parallel actors in one conversation keep their own immutable identity", async () => {
  const releases = new Map<string, () => void>();
  const identifyUser = vi.fn(
    async ({ actor }: { actor: { id: string; name?: string } }) => {
      await new Promise<void>((resolve) => releases.set(actor.id, resolve));
      return { id: `person:${actor.id}`, name: actor.name ?? actor.id };
    },
  );
  const adapter = new FakeAdapter({ platform: "intelligence" });
  const channel = createChannel({ adapters: [adapter], identifyUser } as never);
  const received: unknown[] = [];
  channel.onMessage(({ message }) => {
    received.push(message);
  });
  await channel.ɵruntime.start();
  const sink = adapter.getSink();
  const event = (actorId: string) => ({
    conversationKey: "shared-conversation",
    replyTarget: {},
    userText: `hello from ${actorId}`,
    platform: "slack",
    actor: { id: actorId, kind: "human" as const, name: actorId.toUpperCase() },
    identityContext: {
      tenant: { id: "T1" },
      installation: { id: "I1" },
      conversation: { id: "C1", kind: "channel" },
      trigger: "message",
      event: { id: `event:${actorId}` },
      raw: { actorId },
    },
  });

  const first = sink.onTurn(event("ada") as never);
  const second = sink.onTurn(event("grace") as never);
  await vi.waitFor(() => expect(identifyUser).toHaveBeenCalledTimes(2));
  releases.get("grace")?.();
  releases.get("ada")?.();
  await Promise.all([first, second]);

  expect(received).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        user: { id: "person:ada", name: "ADA" },
        actor: { id: "ada", kind: "human", name: "ADA" },
      }),
      expect.objectContaining({
        user: { id: "person:grace", name: "GRACE" },
        actor: { id: "grace", kind: "human", name: "GRACE" },
      }),
    ]),
  );
});
