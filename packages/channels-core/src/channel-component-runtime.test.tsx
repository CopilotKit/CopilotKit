import { object, schema, streaming, string } from "@copilotkit/schema";
import { Section } from "@copilotkit/channels-ui";
import { z } from "zod";
import { expect, test, vi } from "vitest";
import { ActionRegistry } from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";
import { defineChannelComponent } from "./channel-component.js";
import { createChannelComponentCoordinator } from "./channel-component-runtime.js";
import type { ChannelComponentDelivery } from "./channel-component-runtime.js";
import { createChannelComponentStore } from "./component-store.js";
import { MemoryStore } from "./state/memory-store.js";

function setup() {
  const state = new MemoryStore();
  const store = createChannelComponentStore(state);
  const registry = new ActionRegistry({
    store: new InMemoryActionStore(),
    componentStore: store,
  });
  const posted: unknown[] = [];
  const updated: unknown[] = [];
  const delivery: ChannelComponentDelivery = {
    platform: "slack",
    post: vi.fn(async (ir) => {
      posted.push(ir);
      return { id: "provider-message" };
    }),
    update: vi.fn(async (_ref, ir) => {
      updated.push(ir);
    }),
  };
  return { delivery, posted, registry, state, store, updated };
}

test("a streaming controller posts partial props and replaces the same message with ready props", async () => {
  const fixture = setup();
  const component = defineChannelComponent({
    name: "show_order",
    description: "Show an order",
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
  const coordinator = createChannelComponentCoordinator({
    components: [component],
    store: fixture.store,
    registry: fixture.registry,
    minIntervalMs: () => 0,
    sleep: async () => undefined,
  });
  const run = coordinator.createRun(fixture.delivery);

  run.start("call-1", "show_order");
  run.acceptDelta("call-1", '{"title":"hel');
  run.acceptDelta("call-1", 'lo"}');
  const toolResult = await run.finish({
    toolCallId: "call-1",
    toolCallName: "show_order",
    toolCallArgs: { title: "hello" },
  });

  expect(fixture.posted).toHaveLength(1);
  expect(fixture.updated).toHaveLength(1);
  expect(toolResult).toBe(
    'Rendered component "show_order" in the current thread.',
  );
  expect(
    await fixture.store.getInstance(run.instanceId("call-1")),
  ).toMatchObject({
    phase: "ready",
    props: { title: "hello" },
  });
});

test("initial state and the instance snapshot exist before the first provider post", async () => {
  const state = new MemoryStore();
  const store = createChannelComponentStore(state);
  const registry = new ActionRegistry({
    store: new InMemoryActionStore(),
    componentStore: store,
  });
  const component = defineChannelComponent({
    name: "ordered_card",
    description: "Check first post ordering",
    parameters: z.object({ title: z.string() }),
    getInitialState: () => ({ initialized: true }),
    callbacks: {},
    render: (context) => Section({ children: context.phase }),
  });
  let instanceId = "";
  const coordinator = createChannelComponentCoordinator({
    components: [component],
    store,
    registry,
    minIntervalMs: () => 0,
  });
  const run = coordinator.createRun({
    platform: "teams",
    async post() {
      expect(await store.getInstance(instanceId)).toMatchObject({
        state: { initialized: true },
        phase: "ready",
      });
      return { id: "provider-message" };
    },
    update: async () => undefined,
  });
  run.start("call-order", "ordered_card", "run-order");
  instanceId = run.instanceId("call-order");

  await run.finish({
    toolCallId: "call-order",
    toolCallName: "ordered_card",
    toolCallArgs: { title: "hello" },
  });
});

test("RUN_ERROR cannot later turn the failed component into a successful tool result", async () => {
  const fixture = setup();
  const component = defineChannelComponent({
    name: "run_error_card",
    description: "Run error card",
    parameters: schema(object({ title: string() }), streaming()),
    render: (context) => Section({ children: context.phase }),
  });
  const run = createChannelComponentCoordinator({
    components: [component],
    store: fixture.store,
    registry: fixture.registry,
    minIntervalMs: () => 0,
  }).createRun(fixture.delivery);
  run.start("call-error", "run_error_card", "run-error");
  run.acceptDelta("call-error", '{"title":"hello"}');
  await run.subscriber.onRunErrorEvent?.({
    event: {
      type: "RUN_ERROR",
      runId: "run-error",
      message: "agent run failed",
    },
  } as never);

  await expect(
    run.finish({
      toolCallId: "call-error",
      toolCallName: "run_error_card",
      toolCallArgs: { title: "hello" },
    }),
  ).rejects.toThrow("agent run failed");
});

test("concurrent failure paths deliver one terminal failed revision", async () => {
  const fixture = setup();
  const component = defineChannelComponent({
    name: "broken_order",
    description: "Broken component",
    parameters: schema(object({ title: string() }), streaming()),
    getInitialState() {
      throw new Error("initial state failed");
    },
    callbacks: {},
    render(context) {
      return Section({ children: context.phase });
    },
  });
  const coordinator = createChannelComponentCoordinator({
    components: [component],
    store: fixture.store,
    registry: fixture.registry,
    minIntervalMs: () => 0,
    sleep: async () => undefined,
  });
  const run = coordinator.createRun(fixture.delivery);
  run.start("call-1", "broken_order");

  await Promise.allSettled([
    run.finish({
      toolCallId: "call-1",
      toolCallName: "broken_order",
      toolCallArgs: { title: "hello" },
    }),
    run.failAll(new Error("run failed")),
  ]);

  expect(fixture.posted).toHaveLength(1);
  expect(fixture.updated).toHaveLength(0);
  expect(
    await fixture.store.getInstance(run.instanceId("call-1")),
  ).toMatchObject({
    phase: "failed",
    revision: 1,
  });
});

test("a setState render error persists the accepted state in a failed snapshot", async () => {
  const fixture = setup();
  const component = defineChannelComponent({
    name: "stateful_order",
    description: "Stateful component",
    parameters: schema(object({ title: string() }), streaming()),
    getInitialState: () => ({ count: 0 }),
    callbacks: {},
    render(context) {
      if (context.phase !== "failed" && context.state.count === 1) {
        throw new Error("render failed");
      }
      return Section({ children: context.phase });
    },
  });
  const coordinator = createChannelComponentCoordinator({
    components: [component],
    store: fixture.store,
    registry: fixture.registry,
    minIntervalMs: () => 0,
  });
  const run = coordinator.createRun(fixture.delivery);
  run.start("call-1", "stateful_order");
  run.acceptDelta("call-1", '{"title":"hello"}');
  const instanceId = run.instanceId("call-1");

  await expect(
    coordinator.setState?.(instanceId, { count: 1 }, {
      message: { ref: { id: "provider-message" } },
    } as never),
  ).rejects.toThrow("render failed");

  expect(await fixture.store.getInstance(instanceId)).toMatchObject({
    phase: "failed",
    state: { count: 1 },
  });
});

test("streaming renders retain identity for unchanged nested props branches", () => {
  const fixture = setup();
  const branches: unknown[] = [];
  const component = defineChannelComponent({
    name: "identity_card",
    description: "Retain branch identity",
    parameters: schema(
      object({
        stable: schema(object({ value: string() }), streaming()),
        changing: schema(string(), streaming()),
      }),
      streaming(),
    ),
    render(context) {
      if (context.phase === "streaming") branches.push(context.props.stable);
      return Section({ children: context.phase });
    },
  });
  const run = createChannelComponentCoordinator({
    components: [component],
    store: fixture.store,
    registry: fixture.registry,
    minIntervalMs: () => 0,
  }).createRun(fixture.delivery);

  run.start("call-identity", "identity_card", "run-identity");
  run.acceptDelta("call-identity", '{"stable":{"value":"same"},"changing":"a');
  run.acceptDelta("call-identity", "b");

  expect(branches).toHaveLength(2);
  expect(branches[1]).toBe(branches[0]);
});

test("third-party final-only schemas enforce the raw argument byte limit", async () => {
  const fixture = setup();
  const component = defineChannelComponent({
    name: "limited_card",
    description: "Limit raw input",
    parameters: z.object({
      value: z.string().transform(() => "small"),
    }),
    render(context) {
      return Section({ children: context.phase });
    },
  });
  const coordinator = createChannelComponentCoordinator({
    components: [component],
    store: fixture.store,
    registry: fixture.registry,
    minIntervalMs: () => 0,
  });
  const run = coordinator.createRun(fixture.delivery);
  const raw = JSON.stringify({ value: "x".repeat(65_536) });
  run.start("call-limit", "limited_card", "run-limit");
  run.acceptDelta("call-limit", raw);

  await expect(
    run.finish({
      toolCallId: "call-limit",
      toolCallName: "limited_card",
      toolCallArgs: { value: "x".repeat(65_536) },
    }),
  ).rejects.toMatchObject({ message: expect.stringContaining("max_bytes") });
  expect(
    await fixture.store.getInstance(run.instanceId("call-limit")),
  ).toMatchObject({
    phase: "failed",
    error: { code: "max_bytes" },
  });
});

test("a live updater reads the latest persisted state before computing", async () => {
  const fixture = setup();
  const component = defineChannelComponent({
    name: "stored_state_card",
    description: "Use stored state",
    parameters: schema(object({ title: string() }), streaming()),
    getInitialState: () => ({ count: 0 }),
    callbacks: {},
    render(context) {
      return Section({ children: `${context.phase}:${context.state.count}` });
    },
  });
  const coordinator = createChannelComponentCoordinator({
    components: [component],
    store: fixture.store,
    registry: fixture.registry,
    minIntervalMs: () => 0,
  });
  const run = coordinator.createRun(fixture.delivery);
  run.start("call-state", "stored_state_card", "run-state");
  run.acceptDelta("call-state", '{"title":"hello"}');
  const id = run.instanceId("call-state");
  await vi.waitFor(async () => {
    expect(await fixture.store.getInstance(id)).toMatchObject({
      phase: "streaming",
    });
  });
  const stored = await fixture.store.getInstance(id);
  await fixture.store.putInstance(id, {
    ...stored!,
    state: { count: 5 },
    revision: stored!.revision + 1,
  });

  await coordinator.setState?.(
    id,
    (state: { count: number }) => ({ count: state.count + 1 }),
    { message: { ref: { id: "provider-message" } } } as never,
  );

  expect(await fixture.store.getInstance(id)).toMatchObject({
    state: { count: 6 },
  });
});

test("cold ready render failure persists failed state and replaces with the failed view", async () => {
  const fixture = setup();
  const component = defineChannelComponent({
    name: "cold_card",
    description: "Cold state update",
    parameters: z.object({ title: z.string() }),
    getInitialState: () => ({ count: 0 }),
    callbacks: {},
    render(context) {
      if (context.phase === "ready" && context.state.count === 1) {
        throw new Error("cold render failed");
      }
      return Section({ children: context.phase });
    },
  });
  const coordinator = createChannelComponentCoordinator({
    components: [component],
    store: fixture.store,
    registry: fixture.registry,
    minIntervalMs: () => 0,
  });
  await fixture.store.putInstance("cold-instance", {
    version: 1,
    componentName: "cold_card",
    phase: "ready",
    props: { title: "hello" },
    state: { count: 0 },
    revision: 1,
  });
  const update = vi.fn(async () => undefined);

  await expect(
    coordinator.setState?.("cold-instance", { count: 1 }, {
      message: { ref: { id: "provider-message" } },
      platform: "slack",
      thread: { ɵupdateChannelComponent: update },
    } as never),
  ).rejects.toThrow("cold render failed");

  expect(await fixture.store.getInstance("cold-instance")).toMatchObject({
    phase: "failed",
    state: { count: 1 },
    error: { message: "cold render failed" },
  });
  expect(update).toHaveBeenCalledOnce();
});

test("cold interrupted recovery retries failed UI then uses the SDK safe view", async () => {
  const fixture = setup();
  const component = defineChannelComponent({
    name: "interrupted_card",
    description: "Interrupted card",
    parameters: z.object({ title: z.string() }),
    render(context) {
      return Section({
        children:
          context.phase === "failed" ? "developer failed view" : context.phase,
      });
    },
  });
  const coordinator = createChannelComponentCoordinator({
    components: [component],
    store: fixture.store,
    registry: fixture.registry,
    minIntervalMs: () => 0,
    sleep: async () => undefined,
    maxAttempts: 3,
  });
  const snapshot = {
    version: 1 as const,
    componentName: "interrupted_card",
    phase: "failed" as const,
    props: { title: "hello" },
    revision: 2,
    error: { code: "interrupted", message: "interrupted" },
  };
  const update = vi.fn(async (_ref, ir) => {
    if (JSON.stringify(ir).includes("developer failed view")) {
      throw new Error("provider rejected developer view");
    }
  });

  await expect(
    coordinator.onInterrupted?.("interrupted-instance", snapshot, {
      message: { ref: { id: "provider-message" } },
      platform: "slack",
      thread: { ɵupdateChannelComponent: update },
    } as never),
  ).resolves.toBeUndefined();

  expect(update).toHaveBeenCalledTimes(4);
  expect(JSON.stringify(update.mock.calls.at(-1)?.[1])).toContain(
    "This component could not be displayed.",
  );
});

test("cold provider failure retries then persists failed state without restoring stale state", async () => {
  const fixture = setup();
  const component = defineChannelComponent({
    name: "cold_provider_card",
    description: "Recover from provider failure",
    parameters: z.object({ title: z.string() }),
    getInitialState: () => ({ count: 0 }),
    callbacks: {},
    render(context) {
      return Section({ children: `${context.phase}:${context.state.count}` });
    },
  });
  const coordinator = createChannelComponentCoordinator({
    components: [component],
    store: fixture.store,
    registry: fixture.registry,
    sleep: async () => undefined,
    maxAttempts: 3,
  });
  await fixture.store.putInstance("cold-provider-instance", {
    version: 1,
    componentName: "cold_provider_card",
    phase: "ready",
    props: { title: "hello" },
    state: { count: 4 },
    revision: 1,
  });
  const update = vi.fn(async (_ref, ir) => {
    if (JSON.stringify(ir).includes("ready:5")) {
      throw new Error("provider unavailable");
    }
  });

  await expect(
    coordinator.setState?.(
      "cold-provider-instance",
      (state: { count: number }) => ({ count: state.count + 1 }),
      {
        message: { ref: { id: "provider-message" } },
        platform: "slack",
        thread: { ɵupdateChannelComponent: update },
      } as never,
    ),
  ).rejects.toThrow("provider unavailable");

  expect(update).toHaveBeenCalledTimes(4);
  expect(
    await fixture.store.getInstance("cold-provider-instance"),
  ).toMatchObject({
    phase: "failed",
    state: { count: 5 },
    revision: 3,
    error: { message: "provider unavailable" },
  });
});

test("callback errors are logged and show one portable interaction error", async () => {
  const fixture = setup();
  const component = defineChannelComponent({
    name: "callback_card",
    description: "Callback card",
    parameters: z.object({}),
    render: () => Section({ children: "card" }),
  });
  const coordinator = createChannelComponentCoordinator({
    components: [component],
    store: fixture.store,
    registry: fixture.registry,
  });
  const error = new Error("callback exploded");
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const post = vi.fn(async () => ({ id: "error-message" }));

  await coordinator.onCallbackError?.(error, {
    platform: "teams",
    thread: { post },
  } as never);

  expect(log).toHaveBeenCalledWith(
    "[channel-component] callback failed",
    expect.objectContaining({ error, platform: "teams" }),
  );
  expect(post).toHaveBeenCalledOnce();
  log.mockRestore();
});

test("component delivery uses the adapter retry policy", async () => {
  const fixture = setup();
  const post = vi.fn(async () => {
    throw new Error("provider rejected component");
  });
  const component = defineChannelComponent({
    name: "policy_card",
    description: "Use provider delivery policy",
    parameters: z.object({ title: z.string() }),
    render: (context) => Section({ children: context.phase }),
  });
  const run = createChannelComponentCoordinator({
    components: [component],
    store: fixture.store,
    registry: fixture.registry,
  }).createRun({
    platform: "slack",
    policy: { minIntervalMs: 0, maxAttempts: 1 },
    post,
    update: async () => undefined,
  } as never);
  run.start("policy-call", "policy_card", "policy-run");

  await expect(
    run.finish({
      runId: "policy-run",
      toolCallId: "policy-call",
      toolCallName: "policy_card",
      toolCallArgs: { title: "hello" },
    }),
  ).rejects.toThrow("provider rejected component");

  expect(post).toHaveBeenCalledTimes(3);
});
