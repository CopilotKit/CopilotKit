import { expect, test, vi } from "vitest";
import {
  ActionRegistry,
  FakeAgent,
  InMemoryActionStore,
  MemoryStore,
  Thread,
} from "@copilotkit/channels-core";
import type { Renderable, ThreadDeps } from "@copilotkit/channels-core";
import { LiveSessionAdapter } from "./live-session-adapter.js";
import { LiveSessionTransport } from "./live-session-transport.js";
import type { LiveSessionDelivery } from "./live-session-transport.js";
import type {
  RealtimeGatewayDeliveryChannel,
  RealtimeGatewaySession,
} from "./realtime-gateway.js";

class DeferredActionRegistry extends ActionRegistry {
  constructor(private readonly bindingGate: Promise<void>) {
    super({ store: new InMemoryActionStore() });
  }

  override async bindRenderable(
    ui: Renderable,
    conversationKey: string,
  ): ReturnType<ActionRegistry["bindRenderable"]> {
    await this.bindingGate;
    return super.bindRenderable(ui, conversationKey);
  }
}

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
  };
}

function admittedDelivery(): LiveSessionDelivery {
  return {
    protocol: "channel_session_v1",
    deliveryId: "dlv_operation_tracking",
    deliveryCode: "dcode_operation_tracking",
    sessionTopic: "channel_session:dlv_operation_tracking",
    canonicalThreadId: "thread_operation_tracking",
    appUserId: "user_operation_tracking",
    channelId: "channel_operation_tracking",
    adapter: "slack",
    turn: {
      id: "turn_operation_tracking",
      eventId: "event_operation_tracking",
      receivedAt: "2026-07-29T00:00:00.000Z",
      input: { kind: "text", text: "hello" },
    },
  };
}

function setup(
  options: {
    effectError?: Error;
    handler?: (thread: Thread) => Promise<void>;
    runCanonical?: () => Promise<{
      iterations: number;
      interrupted: boolean;
    }>;
  } = {},
) {
  const binding = deferred();
  const handlerReturned = deferred();
  const events: string[] = [];
  let deliveryNotice: ((payload: unknown) => void) | undefined;
  const deliveryChannel: RealtimeGatewayDeliveryChannel = {
    push: vi.fn(async (event) => {
      events.push(event);
      if (event === "channel.effect.v1" && options.effectError) {
        throw options.effectError;
      }
      return event === "channel.effect.v1"
        ? { receivedThrough: 0, appliedThrough: 0 }
        : {};
    }),
    on: vi.fn(),
    leave: vi.fn(),
  };
  const gatewaySession: RealtimeGatewaySession = {
    push: vi.fn(),
    on: (_event, handler) => {
      deliveryNotice = handler;
    },
    join: vi.fn(async () => deliveryChannel),
  };
  const transport = new LiveSessionTransport({
    session: gatewaySession,
    runtimeInstanceId: "runtime_operation_tracking",
  });
  const adapter = new LiveSessionAdapter({
    transport,
    runCanonical:
      options.runCanonical ??
      (async () => ({ iterations: 0, interrupted: false })),
    loadHistory: async () => [],
  });
  const registry = new DeferredActionRegistry(binding.promise);
  const state = new MemoryStore();

  transport.start(async (session, delivery) => {
    const deps: ThreadDeps = {
      adapter,
      replyTarget: {
        session,
        delivery,
      },
      conversationKey: delivery.canonicalThreadId,
      registry,
      agentFactory: () => new FakeAgent(),
      tools: new Map(),
      toolDescriptors: [],
      context: [],
      registerWaiter: () => undefined,
      interruptHandlers: new Map(),
      state,
    };
    const thread = new Thread(deps);

    if (options.handler) {
      await options.handler(thread);
    } else {
      void thread.post("late response");
    }
    handlerReturned.resolve();
  });

  return {
    binding,
    deliveryChannel,
    events,
    handlerReturned: handlerReturned.promise,
    transport,
    deliver: () => deliveryNotice?.(admittedDelivery()),
  };
}

test("delivery completion waits for a fire-and-forget Thread post that is still binding", async () => {
  const {
    binding,
    deliveryChannel,
    events,
    handlerReturned,
    transport,
    deliver,
  } = setup();

  deliver();
  await handlerReturned;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  try {
    expect(events).not.toContain("channel.delivery.complete.v1");
  } finally {
    binding.resolve();
    await transport.stop();
  }

  expect(events).toEqual(["channel.effect.v1", "channel.delivery.complete.v1"]);
  expect(deliveryChannel.leave).toHaveBeenCalledOnce();
});

test("a rejected fire-and-forget Thread post fails the delivery instead of completing it", async () => {
  const { binding, deliveryChannel, events, transport, deliver } = setup({
    effectError: new Error("provider effect rejected"),
  });

  deliver();
  binding.resolve();
  await transport.stop();

  expect(events).toEqual([
    "channel.effect.v1",
    "channel.effect.v1",
    "channel.delivery.fail.v1",
  ]);
  expect(events).not.toContain("channel.delivery.complete.v1");
  expect(deliveryChannel.leave).toHaveBeenCalledOnce();
});

test("a discarded Thread failure that settles before handler return still fails the delivery", async () => {
  const { binding, deliveryChannel, events, transport, deliver } = setup({
    effectError: new Error("provider effect rejected immediately"),
    handler: async (thread) => {
      void thread.post("discarded response");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    },
  });

  deliver();
  binding.resolve();
  await transport.stop();

  expect(events).toEqual([
    "channel.effect.v1",
    "channel.effect.v1",
    "channel.delivery.fail.v1",
  ]);
  expect(events).not.toContain("channel.delivery.complete.v1");
  expect(deliveryChannel.leave).toHaveBeenCalledOnce();
});

test("a caught runAgent failure can post a fallback and complete the delivery", async () => {
  const agentFailure = new Error("canonical agent failed");
  const caught: unknown[] = [];
  const { binding, deliveryChannel, events, transport, deliver } = setup({
    runCanonical: async () => {
      throw agentFailure;
    },
    handler: async (thread) => {
      try {
        await thread.runAgent();
      } catch (error) {
        caught.push(error);
      }
      await thread.post("fallback response");
    },
  });

  deliver();
  binding.resolve();
  await transport.stop();

  expect(caught).toEqual([agentFailure]);
  expect(events).toContain("channel.delivery.complete.v1");
  expect(events).not.toContain("channel.delivery.fail.v1");
  expect(deliveryChannel.leave).toHaveBeenCalledOnce();
});
