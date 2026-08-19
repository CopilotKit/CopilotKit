import type { AgentSubscriber } from "@ag-ui/client";
import { Section } from "@copilotkit/channels-ui";
import { z } from "zod";
import { expect, test, vi } from "vitest";
import { createChannel } from "./create-channel.js";
import { defineChannelComponent } from "./channel-component.js";
import type { ChannelComponentDefinition } from "./channel-component.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";

function setup(args: {
  component: ChannelComponentDefinition;
  platform?: string;
  toolArgs?: Record<string, unknown>;
}) {
  const adapter = new FakeAdapter({ platform: "intelligence" });
  let iterations = 0;
  const agent = new FakeAgent([
    (subscriber: AgentSubscriber) => {
      iterations += 1;
      subscriber.onToolCallEndEvent?.({
        event: { toolCallId: "component-call-1" },
        toolCallName: args.component.name,
        toolCallArgs: args.toolArgs ?? {},
      } as never);
    },
    () => {
      iterations += 1;
    },
  ]);
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent: () => agent,
    components: [args.component],
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent();
  });

  return {
    adapter,
    channel,
    iterations: () => iterations,
    async run() {
      await channel.ɵruntime.start();
      await adapter.getSink().onTurn({
        conversationKey: "conversation-1",
        replyTarget: {},
        userText: "show the order",
        platform: args.platform ?? "slack",
      });
    },
  };
}

test("a channel component validates args, renders synchronously, and posts through the strict path", async () => {
  const render = vi.fn(
    (context: {
      phase: string;
      platform: string;
      props?: { orderId: string };
    }) => {
      return Section({
        children: `${context.phase}:${context.platform}:${context.props?.orderId}`,
      });
    },
  );
  const component = defineChannelComponent({
    name: "show_order",
    description: "Show one order",
    parameters: z.object({ orderId: z.string() }),
    render,
  });
  const harness = setup({
    component,
    platform: "teams",
    toolArgs: { orderId: "order-42" },
  });

  await harness.run();

  expect(render).toHaveBeenCalledWith(
    expect.objectContaining({
      phase: "ready",
      platform: "teams",
      props: { orderId: "order-42" },
    }),
  );
  expect(harness.adapter.posted).toEqual([
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
  expect(harness.iterations()).toBe(2);
});

test("invalid component arguments render a failed component and fail the tool", async () => {
  const render = vi.fn((context: { phase: string }) =>
    Section({ children: context.phase }),
  );
  const component = defineChannelComponent({
    name: "show_order",
    description: "Show one order",
    parameters: z.object({ orderId: z.string() }),
    render,
  });
  const harness = setup({ component, toolArgs: { orderId: 42 } });

  await harness.run();

  expect(render).toHaveBeenCalledWith(
    expect.objectContaining({ phase: "failed" }),
  );
  expect(harness.adapter.posted).toHaveLength(1);
  expect(harness.iterations()).toBe(2);
});

test("channel start rejects component and tool name collisions", async () => {
  const component = defineChannelComponent({
    name: "show_order",
    description: "Show one order",
    parameters: z.object({}),
    render: () => Section({ children: "order" }),
  });
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [new FakeAdapter()],
    components: [component],
    tools: [
      {
        name: "show_order",
        description: "Conflicting tool",
        parameters: z.object({}),
        handler: () => "conflict",
      },
    ],
  });

  await expect(channel.ɵruntime.start()).rejects.toThrow(
    'duplicate channel tool or component name "show_order"',
  );
});

test("MemoryStore warning names lost callback recovery", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const channel = createChannel({
    identifyUser: "platform",
    adapters: [new FakeAdapter()],
    components: [
      defineChannelComponent({
        name: "memory_card",
        description: "Warn about ephemeral recovery",
        parameters: z.object({}),
        render: () => Section({ children: "card" }),
      }),
    ],
  });

  await channel.ɵruntime.start();

  expect(warning).toHaveBeenCalledWith(
    expect.stringContaining("callback recovery"),
  );
  warning.mockRestore();
});
