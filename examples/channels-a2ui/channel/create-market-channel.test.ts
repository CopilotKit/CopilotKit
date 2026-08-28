import { renderToIR } from "@copilotkit/channels";
import type * as ChannelsModule from "@copilotkit/channels";
import type { ChannelNode, InteractionContext } from "@copilotkit/channels";
import { afterEach, describe, expect, it, vi } from "vitest";
import { marketSnapshotProps } from "./market-snapshot.fixture.js";

const fakes = vi.hoisted(() => {
  const channel = { onMention: vi.fn() };
  const agents: Array<{ threadId: string; url: string }> = [];
  return {
    channel,
    options: undefined as unknown,
    createChannel: vi.fn((options: unknown) => {
      fakes.options = options;
      return channel;
    }),
    HttpAgent: vi.fn(function HttpAgent({ url }: { url: string }) {
      const agent = { threadId: "", url };
      agents.push(agent);
      return agent;
    }),
    agents,
  };
});

vi.mock("@copilotkit/channels", async (importOriginal) => ({
  ...(await importOriginal<typeof ChannelsModule>()),
  createChannel: fakes.createChannel,
  HttpAgent: fakes.HttpAgent,
}));

import { createMarketChannel } from "./create-market-channel.js";

afterEach(() => vi.clearAllMocks());

describe("createMarketChannel", () => {
  it("registers A2UI as a component with normal Channels progress", () => {
    createMarketChannel({
      channelName: "market-demo",
      agentUrl: "http://agent.test:8000/",
    });
    const options = fakes.options as {
      showToolStatus: boolean;
      components: Array<{ name: string }>;
      extensions?: unknown;
      agent(threadId: string): { threadId: string };
    };

    expect(options.showToolStatus).toBe(true);
    expect(options.components.map((component) => component.name)).toEqual([
      "render_a2ui",
    ]);
    expect("extensions" in options).toBe(false);
    expect(options.agent("thread-1").threadId).toBe("thread-1");
  });

  it("turns Acknowledge into a normal follow-up Channel turn", async () => {
    createMarketChannel({
      channelName: "market-demo",
      agentUrl: "http://agent.test:8000/",
    });
    const component = (
      fakes.options as { components: Array<{ render: Function }> }
    ).components[0]!;
    const rendered = await component.render(
      {
        surfaceId: "market",
        components: [
          { id: "root", component: "MarketSnapshot", ...marketSnapshotProps },
        ],
      },
      { platform: "slack", signal: new AbortController().signal },
    );
    const message = renderToIR(rendered)[0]!;
    const actions = (message.props.children as ChannelNode[]).find(
      (node) => node.type === "actions",
    )!;
    const button = (actions.props.children as ChannelNode[])[0]!;
    const runAgent = vi.fn(async () => undefined);
    const interaction = {
      thread: { runAgent },
    } as unknown as InteractionContext;

    await (button.props.onClick as (ctx: InteractionContext) => Promise<void>)(
      interaction,
    );

    expect(runAgent).toHaveBeenCalledWith({
      prompt: expect.stringContaining("acknowledge_search_result"),
    });
  });
});
