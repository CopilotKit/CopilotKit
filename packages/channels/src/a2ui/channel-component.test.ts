import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createChannel,
  FakeAdapter,
  FakeAgent,
  renderToIR,
  Section,
} from "@copilotkit/channels-core";
import type {
  ChannelNode,
  InteractionContext,
} from "@copilotkit/channels-core";
import { createChannelA2UICatalog } from "./catalog.js";
import { createChannelA2UIComponent } from "./channel-component.js";

const find = (nodes: ChannelNode[], type: string): ChannelNode | undefined => {
  for (const node of nodes) {
    if (node.type === type) return node;
    if (Array.isArray(node.props.children)) {
      const nested = find(node.props.children as ChannelNode[], type);
      if (nested) return nested;
    }
  }
  return undefined;
};

const findAll = (nodes: ChannelNode[], type: string): ChannelNode[] =>
  nodes.flatMap((node) => [
    ...(node.type === type ? [node] : []),
    ...(Array.isArray(node.props.children)
      ? findAll(node.props.children as ChannelNode[], type)
      : []),
  ]);

const statusCatalog = () =>
  createChannelA2UICatalog(
    {
      ServiceStatus: {
        description: "Complete status for one service.",
        props: z.object({ service: z.string(), status: z.string() }).strict(),
      },
    },
    {
      ServiceStatus: ({ props }) =>
        Section({ children: `${props.service}: ${props.status}` }),
    },
    { catalogId: "copilotkit://service-status/v1" },
  );

describe("createChannelA2UIComponent", () => {
  it("exposes the catalog as one registered render_a2ui component schema", async () => {
    const component = createChannelA2UIComponent({
      catalog: statusCatalog(),
      onAction: vi.fn(),
    });

    expect(component.name).toBe("render_a2ui");
    expect(component.description).toContain("A2UI v0.9");
    const valid = await component.parameters["~standard"].validate({
      surfaceId: "status",
      components: [
        {
          id: "root",
          component: "ServiceStatus",
          service: "api",
          status: "healthy",
        },
      ],
    });
    const invalid = await component.parameters["~standard"].validate({
      surfaceId: "status",
      components: [{ id: "root", component: "InventedCard" }],
    });

    expect(valid.issues).toBeUndefined();
    expect(invalid.issues?.length).toBeGreaterThan(0);
  });

  it("renders one completed A2UI surface through its catalog lowerer", async () => {
    const component = createChannelA2UIComponent({
      catalog: statusCatalog(),
      onAction: vi.fn(),
    });

    const rendered = await component.render(
      {
        surfaceId: "status",
        components: [
          {
            id: "root",
            component: "ServiceStatus",
            service: "api",
            status: "healthy",
          },
        ],
      },
      { platform: "slack", signal: new AbortController().signal },
    );

    expect(JSON.stringify(renderToIR(rendered))).toContain("api: healthy");
  });

  it("routes a resolved A2UI button action through InteractionContext", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const catalog = createChannelA2UICatalog(
      {},
      {},
      {
        includeChannelBasicCatalog: true,
      },
    );
    const component = createChannelA2UIComponent({ catalog, onAction });
    const rendered = await component.render(
      {
        surfaceId: "status",
        components: [
          { id: "root", component: "Column", children: ["retry"] },
          { id: "label", component: "Text", text: "Retry" },
          {
            id: "retry",
            component: "Button",
            child: "label",
            action: {
              event: {
                name: "retry",
                context: { service: { path: "/service" } },
              },
            },
          },
        ],
        data: { service: "api" },
      },
      { platform: "slack", signal: new AbortController().signal },
    );
    const button = find(renderToIR(rendered), "button")!;
    const interaction = { thread: {} } as InteractionContext;

    await (button.props.onClick as (ctx: InteractionContext) => Promise<void>)(
      interaction,
    );

    expect(onAction).toHaveBeenCalledWith({
      action: expect.objectContaining({
        name: "retry",
        surfaceId: "status",
        sourceComponentId: "retry",
        context: { service: "api" },
      }),
      interaction,
    });
  });

  it("keeps local function-call actions out of the next server event", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const catalog = createChannelA2UICatalog(
      {},
      {},
      { includeChannelBasicCatalog: true },
    );
    const component = createChannelA2UIComponent({ catalog, onAction });
    const rendered = await component.render(
      {
        surfaceId: "status",
        components: [
          {
            id: "root",
            component: "Column",
            children: ["calculate", "retry"],
          },
          { id: "calculate-label", component: "Text", text: "Calculate" },
          {
            id: "calculate",
            component: "Button",
            child: "calculate-label",
            action: {
              functionCall: {
                call: "add",
                args: { a: 1, b: 2 },
                returnType: "number",
              },
            },
          },
          { id: "retry-label", component: "Text", text: "Retry" },
          {
            id: "retry",
            component: "Button",
            child: "retry-label",
            action: { event: { name: "retry" } },
          },
        ],
      },
      { platform: "slack", signal: new AbortController().signal },
    );
    const buttons = findAll(renderToIR(rendered), "button");
    const calculate = buttons[0]!;
    const retry = buttons[1]!;
    const calculateInteraction = { thread: { id: "calculate" } } as never;
    const retryInteraction = { thread: { id: "retry" } } as never;

    await (
      calculate.props.onClick as (ctx: InteractionContext) => Promise<void>
    )(calculateInteraction);
    await (retry.props.onClick as (ctx: InteractionContext) => Promise<void>)(
      retryInteraction,
    );

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({
      action: expect.objectContaining({ name: "retry" }),
      interaction: retryInteraction,
    });
  });

  it("correlates concurrent server events with their own interactions", async () => {
    let releaseFirst!: () => void;
    const firstActionGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const onAction = vi.fn(async ({ action }) => {
      if (action.name === "one") await firstActionGate;
    });
    const catalog = createChannelA2UICatalog(
      {},
      {},
      { includeChannelBasicCatalog: true },
    );
    const component = createChannelA2UIComponent({ catalog, onAction });
    const rendered = await component.render(
      {
        surfaceId: "status",
        components: [
          { id: "root", component: "Row", children: ["one", "two"] },
          { id: "one-label", component: "Text", text: "One" },
          { id: "two-label", component: "Text", text: "Two" },
          {
            id: "one",
            component: "Button",
            child: "one-label",
            action: { event: { name: "one" } },
          },
          {
            id: "two",
            component: "Button",
            child: "two-label",
            action: { event: { name: "two" } },
          },
        ],
      },
      { platform: "slack", signal: new AbortController().signal },
    );
    const buttons = findAll(renderToIR(rendered), "button");
    const one = buttons[0]!;
    const two = buttons[1]!;
    const oneInteraction = { thread: { id: "one" } } as never;
    const twoInteraction = { thread: { id: "two" } } as never;

    const oneClick = (
      one.props.onClick as (ctx: InteractionContext) => Promise<void>
    )(oneInteraction);
    await vi.waitFor(() => expect(onAction).toHaveBeenCalledTimes(1));
    const twoClick = (
      two.props.onClick as (ctx: InteractionContext) => Promise<void>
    )(twoInteraction);
    await expect(twoClick).resolves.toBeUndefined();

    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction).toHaveBeenNthCalledWith(2, {
      action: expect.objectContaining({ name: "two" }),
      interaction: twoInteraction,
    });
    releaseFirst();
    await oneClick;
    expect(onAction.mock.calls).toEqual([
      [
        {
          action: expect.objectContaining({ name: "one" }),
          interaction: oneInteraction,
        },
      ],
      [
        {
          action: expect.objectContaining({ name: "two" }),
          interaction: twoInteraction,
        },
      ],
    ]);
  });

  it("rejects a Channel interaction when onAction rejects", async () => {
    const onAction = vi.fn().mockRejectedValue(new Error("agent failed"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const catalog = createChannelA2UICatalog(
      {},
      {},
      { includeChannelBasicCatalog: true },
    );
    const component = createChannelA2UIComponent({ catalog, onAction });
    const rendered = await component.render(
      {
        surfaceId: "status",
        components: [
          { id: "root", component: "Column", children: ["retry"] },
          { id: "label", component: "Text", text: "Retry" },
          {
            id: "retry",
            component: "Button",
            child: "label",
            action: { event: { name: "retry" } },
          },
        ],
      },
      { platform: "slack", signal: new AbortController().signal },
    );
    const button = find(renderToIR(rendered), "button")!;

    try {
      await expect(
        (button.props.onClick as (ctx: InteractionContext) => Promise<void>)({
          thread: {},
        } as InteractionContext),
      ).rejects.toThrow("agent failed");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("rejects duplicate component ids and requires exactly one root", async () => {
    const component = createChannelA2UIComponent({
      catalog: statusCatalog(),
      onAction: vi.fn(),
    });
    const duplicateIds = await component.parameters["~standard"].validate({
      surfaceId: "status",
      components: [
        {
          id: "root",
          component: "ServiceStatus",
          service: "api",
          status: "healthy",
        },
        {
          id: "duplicate",
          component: "ServiceStatus",
          service: "worker",
          status: "healthy",
        },
        {
          id: "duplicate",
          component: "ServiceStatus",
          service: "queue",
          status: "healthy",
        },
      ],
    });
    const duplicateRoots = await component.parameters["~standard"].validate({
      surfaceId: "status",
      components: [
        {
          id: "root",
          component: "ServiceStatus",
          service: "api",
          status: "healthy",
        },
        {
          id: "root",
          component: "ServiceStatus",
          service: "worker",
          status: "healthy",
        },
      ],
    });
    const missingRoot = await component.parameters["~standard"].validate({
      surfaceId: "status",
      components: [
        {
          id: "service",
          component: "ServiceStatus",
          service: "api",
          status: "healthy",
        },
      ],
    });

    expect(duplicateIds.issues?.map((issue) => issue.message)).toContain(
      'Duplicate component id "duplicate"',
    );
    expect(duplicateRoots.issues?.map((issue) => issue.message)).toContain(
      'Duplicate component id "root"',
    );
    expect(duplicateRoots.issues?.map((issue) => issue.message)).toContain(
      'Expected exactly one component with id "root"',
    );
    expect(missingRoot.issues?.map((issue) => issue.message)).toContain(
      'Expected exactly one component with id "root"',
    );
  });

  it("rejects a completed surface without a root component", () => {
    const component = createChannelA2UIComponent({
      catalog: statusCatalog(),
      onAction: vi.fn(),
    });

    expect(() =>
      component.render(
        {
          surfaceId: "status",
          components: [
            {
              id: "not-root",
              component: "ServiceStatus",
              service: "api",
              status: "healthy",
            },
          ],
        },
        { platform: "slack", signal: new AbortController().signal },
      ),
    ).toThrow('waiting for component "root"');
  });

  it("posts through the existing registered Channel component path", async () => {
    const adapter = new FakeAdapter();
    const component = createChannelA2UIComponent({
      catalog: statusCatalog(),
      onAction: vi.fn(),
    });
    const agent = new FakeAgent([
      (subscriber) => {
        subscriber.onToolCallEndEvent?.({
          event: { toolCallId: "render-1" },
          toolCallName: "render_a2ui",
          toolCallArgs: {
            surfaceId: "status",
            components: [
              {
                id: "root",
                component: "ServiceStatus",
                service: "worker",
                status: "ready",
              },
            ],
          },
        } as never);
      },
      () => undefined,
    ]);
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [adapter],
      agent,
      components: [component],
    });
    channel.onMessage(async ({ thread }) => {
      await thread.runAgent();
    });

    await channel.ɵruntime.start();
    await adapter.getSink().onTurn({
      conversationKey: "c1",
      replyTarget: {},
      userText: "status",
      platform: "fake",
    });

    expect(adapter.posted).toHaveLength(1);
    expect(JSON.stringify(adapter.posted[0])).toContain("worker: ready");
  });
});
