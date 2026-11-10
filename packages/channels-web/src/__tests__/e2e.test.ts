import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType, HttpAgent } from "@ag-ui/client";
import type { BaseEvent, CustomEvent } from "@ag-ui/client";
import { createChannel } from "@copilotkit/channels-core";
import type { Channel, StatefulThread } from "@copilotkit/channels-core";
import { Actions, Button, Message, Section } from "@copilotkit/channels-ui";
import { z } from "zod";
import { web } from "../adapter.js";
import type { WebAdapter } from "../adapter.js";
import { CHANNELS_UI_EVENT } from "../wire.js";
import type { ChannelsUiEventValue, WebUiNode } from "../wire.js";
import { ScriptedAgent, textReply, toolCall } from "./helpers.js";
import type { ScriptStep } from "./helpers.js";

let channel: Channel | undefined;

afterEach(async () => {
  await channel?.stop();
  channel = undefined;
  vi.restoreAllMocks();
});

async function setup(
  script: ScriptStep[],
  configure: (channel: Channel) => void,
  tools: Parameters<typeof createChannel>[0]["tools"] = [],
): Promise<{ adapter: WebAdapter; agent: ScriptedAgent }> {
  const adapter = web();
  const agent = new ScriptedAgent(script);
  channel = createChannel({
    identifyUser: "platform",
    adapters: [adapter],
    agent,
    tools,
  });
  configure(channel);
  await channel.start();
  return { adapter, agent };
}

function client(adapter: WebAdapter, threadId = "thread-1"): HttpAgent {
  return new HttpAgent({
    url: "https://app.test/api/channel",
    threadId,
    fetch: (url, init) => adapter.handler(new Request(url, init)),
  });
}

async function run(
  agent: HttpAgent,
  params: Parameters<HttpAgent["runAgent"]>[0] = {},
): Promise<BaseEvent[]> {
  const events: BaseEvent[] = [];
  await agent.runAgent(params, {
    onEvent({ event }) {
      events.push(event);
    },
  });
  return events;
}

function uiEvents(events: BaseEvent[]): ChannelsUiEventValue[] {
  return events
    .filter(
      (e): e is CustomEvent =>
        e.type === EventType.CUSTOM &&
        (e as CustomEvent).name === CHANNELS_UI_EVENT,
    )
    .map((e) => e.value as ChannelsUiEventValue);
}

function findNode(nodes: WebUiNode[], type: string): WebUiNode | undefined {
  for (const node of nodes) {
    if (node.type === type) return node;
    const inner = findNode(node.props.children ?? [], type);
    if (inner) return inner;
  }
  return undefined;
}

describe("web adapter end to end", () => {
  it("answers a user message with the agent's streamed reply", async () => {
    const { adapter, agent } = await setup(
      [() => textReply("a1", "Hello from the agent")],
      (ch) =>
        ch.onMention(async ({ thread }) => {
          await thread.runAgent();
        }),
    );
    const browser = client(adapter);
    browser.addMessage({ id: "u1", role: "user", content: "hi" });

    const events = await run(browser);

    expect(events[0]?.type).toBe(EventType.RUN_STARTED);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    expect(browser.messages.at(-1)).toMatchObject({
      id: "a1",
      role: "assistant",
      content: "Hello from the agent",
    });
    // The agent ran on the history the browser sent, without a second copy
    // of the new user message.
    expect(agent.inputs[0]?.threadId).toBe("thread-1");
    expect(agent.inputs[0]?.messages).toEqual([
      { id: "u1", role: "user", content: "hi" },
    ]);
  });

  it("sends history from earlier turns to the agent", async () => {
    const { adapter, agent } = await setup(
      [() => textReply("a1", "first"), () => textReply("a2", "second")],
      (ch) =>
        ch.onMessage(async ({ thread }) => {
          await thread.runAgent();
        }),
    );
    const browser = client(adapter);
    browser.addMessage({ id: "u1", role: "user", content: "one" });
    await run(browser);
    browser.addMessage({ id: "u2", role: "user", content: "two" });
    await run(browser);

    expect(agent.inputs[1]?.messages.map((m) => m.id)).toEqual([
      "u1",
      "a1",
      "u2",
    ]);
  });

  it("delivers a posted card and round-trips a button click to its onClick", async () => {
    const clicks: unknown[] = [];
    const { adapter } = await setup([], (ch) =>
      ch.onMessage(async ({ thread }) => {
        await thread.post(
          Message({
            children: [
              Section({ children: "Deploy to production?" }),
              Actions({
                children: Button({
                  value: "yes",
                  children: "Deploy",
                  onClick: async (ctx) => {
                    clicks.push(ctx.action.value);
                    await ctx.thread.update(
                      ctx.message.ref,
                      Message({ children: Section({ children: "Deployed" }) }),
                    );
                  },
                }),
              }),
            ],
          }),
        );
      }),
    );
    const browser = client(adapter);
    browser.addMessage({ id: "u1", role: "user", content: "deploy" });

    const first = await run(browser);
    const [posted] = uiEvents(first);
    expect(posted).toBeDefined();
    // The fallback text is an ordinary assistant message with the same id.
    expect(browser.messages.at(-1)).toMatchObject({
      id: posted!.messageId,
      role: "assistant",
      content: "Deploy to production?",
    });
    const button = findNode(posted!.ir, "button");
    expect(button?.props.onClick).toMatch(/^ck:/);
    expect(button?.props.value).toBe("yes");

    const second = await run(browser, {
      forwardedProps: {
        channelInteraction: {
          id: button!.props.onClick,
          value: "yes",
          messageId: posted!.messageId,
        },
      },
    });

    expect(clicks).toEqual(["yes"]);
    const [updated] = uiEvents(second);
    expect(updated?.messageId).toBe(posted!.messageId);
    expect(findNode(updated!.ir, "text")?.props.value).toBe("Deployed");
    expect(second.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });

  it("drops a post when no request is open for the conversation", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    let saved: StatefulThread<unknown> | undefined;
    const { adapter } = await setup([], (ch) =>
      ch.onMessage(({ thread }) => {
        saved = thread;
      }),
    );
    const browser = client(adapter);
    browser.addMessage({ id: "u1", role: "user", content: "hi" });
    await run(browser);

    const ref = await saved!.post("Too late");

    expect(ref).toMatchObject({ threadId: "thread-1" });
    expect(typeof ref.id).toBe("string");
    expect(debug).toHaveBeenCalledWith(expect.stringContaining("post dropped"));
  });

  it("emits the result of a Channel tool so the client history stays valid", async () => {
    const { adapter } = await setup(
      [
        () => toolCall("call-1", "lookup_order", { id: "42" }),
        () => textReply("a2", "Order 42 has shipped."),
      ],
      (ch) =>
        ch.onMessage(async ({ thread }) => {
          await thread.runAgent();
        }),
      [
        {
          name: "lookup_order",
          description: "Look up an order",
          parameters: z.object({ id: z.string() }),
          handler: ({ id }) => `order ${id}: shipped`,
        },
      ],
    );
    const browser = client(adapter);
    browser.addMessage({ id: "u1", role: "user", content: "where is 42?" });

    const events = await run(browser);

    expect(events.map((e) => e.type)).toContain(EventType.TOOL_CALL_RESULT);
    expect(browser.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(browser.messages[2]).toMatchObject({
      role: "tool",
      toolCallId: "call-1",
      content: "order 42: shipped",
    });
  });

  it("resumes an interrupted agent from a click in a later request", async () => {
    const { adapter, agent } = await setup(
      [
        () => [
          {
            type: EventType.CUSTOM,
            name: "on_interrupt",
            value: { question: "Approve?" },
          } as BaseEvent,
        ],
        () => textReply("a2", "Approved and done."),
      ],
      (ch) => {
        ch.onMessage(async ({ thread }) => {
          await thread.runAgent();
        });
        ch.onInterrupt<{ question: string }>(
          "on_interrupt",
          async ({ thread, payload }) => {
            await thread.post(
              Message({
                children: [
                  Section({ children: payload.question }),
                  Actions({
                    children: Button({
                      children: "Approve",
                      onClick: async (ctx) => {
                        await ctx.thread.resume(true);
                      },
                    }),
                  }),
                ],
              }),
            );
          },
        );
      },
    );
    const browser = client(adapter);
    browser.addMessage({ id: "u1", role: "user", content: "ship it" });

    const first = await run(browser);
    const [picker] = uiEvents(first);
    const button = findNode(picker!.ir, "button");
    await run(browser, {
      forwardedProps: {
        channelInteraction: {
          id: button!.props.onClick,
          messageId: picker!.messageId,
        },
      },
    });

    expect(agent.inputs[1]?.forwardedProps).toMatchObject({
      command: { resume: true },
    });
    expect(browser.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Approved and done.",
    });
  });

  it("ends the run with RUN_ERROR when the handler throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { adapter } = await setup([], (ch) =>
      ch.onMessage(() => {
        throw new Error("boom");
      }),
    );
    const browser = client(adapter);
    browser.addMessage({ id: "u1", role: "user", content: "hi" });

    const events = await run(browser);

    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_ERROR,
      message: "boom",
    });
  });
});
