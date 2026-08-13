import type { AgentSubscriber } from "@ag-ui/client";
import { Section } from "@copilotkit/channels-ui";
import { z } from "zod";
import { object, schema, streaming, string } from "@copilotkit/schema";
import { expect, test } from "vitest";
import { defineChannelComponent } from "./channel-component.js";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";

test("a final-only Standard Schema component renders through the ready context", async () => {
  const adapter = new FakeAdapter({ platform: "teams" });
  const agent = new FakeAgent([
    (subscriber: AgentSubscriber) => {
      subscriber.onToolCallStartEvent?.({
        event: {
          type: "TOOL_CALL_START",
          toolCallId: "component-call-1",
          toolCallName: "show_order",
        },
      } as never);
      subscriber.onToolCallArgsEvent?.({
        event: {
          type: "TOOL_CALL_ARGS",
          toolCallId: "component-call-1",
          delta: '{"orderId":"order-42"}',
        },
        toolCallName: "show_order",
        toolCallBuffer: '{"orderId":"order-42"}',
        partialToolCallArgs: { orderId: "order-42" },
      } as never);
      subscriber.onToolCallEndEvent?.({
        event: { type: "TOOL_CALL_END", toolCallId: "component-call-1" },
        toolCallName: "show_order",
        toolCallArgs: { orderId: "order-42" },
      } as never);
    },
    () => undefined,
  ]);
  const component = defineChannelComponent({
    name: "show_order",
    description: "Show one order",
    parameters: z.object({ orderId: z.string() }),
    render(context) {
      if (context.phase !== "ready") {
        return Section({ children: context.phase });
      }
      return Section({
        children: `${context.phase}:${context.platform}:${context.props.orderId}`,
      });
    },
  });
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: () => agent,
    components: [component],
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent();
  });

  await channel.ɵruntime.start();
  await adapter.getSink().onTurn({
    conversationKey: "conversation-1",
    replyTarget: {},
    userText: "show the order",
    platform: "teams",
  });

  expect(adapter.posted).toEqual([
    [
      {
        type: "section",
        props: {
          children: [
            {
              type: "text",
              props: { value: "ready:teams:order-42" },
            },
          ],
        },
      },
    ],
  ]);
});

test("a non-progressive adapter suppresses partial renders and posts one ready component", async () => {
  const adapter = new FakeAdapter({ platform: "discord" });
  Object.defineProperties(adapter, {
    postComponent: { value: undefined },
    updateComponent: { value: undefined },
  });
  const agent = new FakeAgent([
    async (subscriber: AgentSubscriber) => {
      await subscriber.onToolCallArgsEvent?.({
        event: {
          type: "TOOL_CALL_ARGS",
          toolCallId: "component-call-1",
          delta: '{"title":"hel',
        },
        toolCallName: "show_order",
      } as never);
      await subscriber.onToolCallArgsEvent?.({
        event: {
          type: "TOOL_CALL_ARGS",
          toolCallId: "component-call-1",
          delta: 'lo"}',
        },
        toolCallName: "show_order",
      } as never);
      await subscriber.onToolCallEndEvent?.({
        event: { type: "TOOL_CALL_END", toolCallId: "component-call-1" },
        toolCallName: "show_order",
        toolCallArgs: { title: "hello" },
      } as never);
    },
    () => undefined,
  ]);
  const component = defineChannelComponent({
    name: "show_order",
    description: "Show one order",
    parameters: schema(
      object({ title: schema(string(), streaming()) }),
      streaming(),
    ),
    render(context) {
      return Section({
        children: `${context.phase}:${context.props?.title ?? "failed"}`,
      });
    },
  });
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: () => agent,
    components: [component],
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent();
  });

  await channel.ɵruntime.start();
  await adapter.getSink().onTurn({
    conversationKey: "conversation-1",
    replyTarget: {},
    userText: "show the order",
    platform: "discord",
  });

  expect(adapter.posted).toHaveLength(1);
  expect(adapter.updated).toHaveLength(0);
  expect(adapter.posted[0]?.[0]).toMatchObject({
    type: "section",
    props: { children: [{ props: { value: "ready:hello" } }] },
  });
});

test("interleaved component calls keep independent parser and message state", async () => {
  const adapter = new FakeAdapter({ platform: "teams" });
  const agent = new FakeAgent([
    async (subscriber: AgentSubscriber) => {
      for (const [id, title] of [
        ["call-a", "alpha"],
        ["call-b", "beta"],
      ] as const) {
        await subscriber.onToolCallStartEvent?.({
          event: {
            type: "TOOL_CALL_START",
            runId: "run-42",
            toolCallId: id,
            toolCallName: "show_order",
          },
        } as never);
        await subscriber.onToolCallArgsEvent?.({
          event: {
            type: "TOOL_CALL_ARGS",
            runId: "run-42",
            toolCallId: id,
            delta: JSON.stringify({ title }),
          },
          toolCallName: "show_order",
        } as never);
        await subscriber.onToolCallEndEvent?.({
          event: { type: "TOOL_CALL_END", runId: "run-42", toolCallId: id },
          toolCallName: "show_order",
          toolCallArgs: { title },
        } as never);
      }
    },
    () => undefined,
  ]);
  const component = defineChannelComponent({
    name: "show_order",
    description: "Show one order",
    parameters: schema(object({ title: string() }), streaming()),
    render(context) {
      return Section({ children: `${context.phase}:${context.props?.title}` });
    },
  });
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: () => agent,
    components: [component],
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent();
  });

  await channel.ɵruntime.start();
  await adapter.getSink().onTurn({
    conversationKey: "conversation-1",
    replyTarget: {},
    userText: "show both orders",
    platform: "teams",
  });

  expect(adapter.posted).toHaveLength(2);
  expect(
    adapter.posted.map((ir) =>
      JSON.stringify(ir).includes("alpha") ? "alpha" : "beta",
    ),
  ).toEqual(["alpha", "beta"]);
  expect(adapter.updated).toHaveLength(2);
});

test("the same tool-call ID in two AG-UI runs creates two component instances", async () => {
  const adapter = new FakeAdapter({ platform: "teams" });
  const agent = new FakeAgent([
    async (subscriber: AgentSubscriber) => {
      for (const [runId, title] of [
        ["run-a", "alpha"],
        ["run-b", "beta"],
      ] as const) {
        await subscriber.onToolCallStartEvent?.({
          event: {
            type: "TOOL_CALL_START",
            runId,
            toolCallId: "same-call",
            toolCallName: "same_id_card",
          },
        } as never);
        await subscriber.onToolCallArgsEvent?.({
          event: {
            type: "TOOL_CALL_ARGS",
            runId,
            toolCallId: "same-call",
            delta: JSON.stringify({ title }),
          },
          toolCallName: "same_id_card",
        } as never);
        await subscriber.onToolCallEndEvent?.({
          event: { type: "TOOL_CALL_END", runId, toolCallId: "same-call" },
          toolCallName: "same_id_card",
          toolCallArgs: { title },
        } as never);
      }
    },
    () => undefined,
  ]);
  const component = defineChannelComponent({
    name: "same_id_card",
    description: "Render calls from distinct runs",
    parameters: schema(object({ title: string() }), streaming()),
    render: (context) =>
      Section({ children: `${context.phase}:${context.props?.title}` }),
  });
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: () => agent,
    components: [component],
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent();
  });

  await channel.ɵruntime.start();
  await adapter.getSink().onTurn({
    conversationKey: "conversation-1",
    replyTarget: {},
    userText: "show both",
    platform: "teams",
  });

  expect(adapter.posted).toHaveLength(2);
  expect(adapter.posted.map((ir) => JSON.stringify(ir))).toEqual([
    expect.stringContaining("alpha"),
    expect.stringContaining("beta"),
  ]);
});

test("replayed events for one run and tool call reuse the active component instance", async () => {
  const adapter = new FakeAdapter({ platform: "teams" });
  const agent = new FakeAgent([
    async (subscriber: AgentSubscriber) => {
      for (let replay = 0; replay < 2; replay += 1) {
        await subscriber.onToolCallStartEvent?.({
          event: {
            type: "TOOL_CALL_START",
            runId: "replayed-run",
            toolCallId: "replayed-call",
            toolCallName: "replayed_card",
          },
        } as never);
        await subscriber.onToolCallArgsEvent?.({
          event: {
            type: "TOOL_CALL_ARGS",
            runId: "replayed-run",
            toolCallId: "replayed-call",
            delta: '{"title":"one"}',
          },
          toolCallName: "replayed_card",
        } as never);
        await subscriber.onToolCallEndEvent?.({
          event: {
            type: "TOOL_CALL_END",
            runId: "replayed-run",
            toolCallId: "replayed-call",
          },
          toolCallName: "replayed_card",
          toolCallArgs: { title: "one" },
        } as never);
      }
    },
    () => undefined,
  ]);
  let initialStateCalls = 0;
  const component = defineChannelComponent({
    name: "replayed_card",
    description: "Reuse one active instance",
    parameters: schema(object({ title: string() }), streaming()),
    getInitialState() {
      initialStateCalls += 1;
      return { clicks: 0 };
    },
    callbacks: {},
    render: (context) =>
      Section({ children: `${context.phase}:${context.props?.title}` }),
  });
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: () => agent,
    components: [component],
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent();
  });

  await channel.ɵruntime.start();
  await adapter.getSink().onTurn({
    conversationKey: "conversation-1",
    replyTarget: {},
    userText: "show it once",
    platform: "teams",
  });

  expect(initialStateCalls).toBe(1);
  expect(adapter.posted).toHaveLength(1);
  expect(adapter.updated).toHaveLength(1);
  expect(JSON.stringify(adapter.updated[0]?.ir)).toContain("ready:one");
});
