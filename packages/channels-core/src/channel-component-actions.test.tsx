import { Button, createChannelCallbackBinding } from "@copilotkit/channels-ui";
import type { InteractionContext, Thread } from "@copilotkit/channels-ui";
import { expect, test, vi } from "vitest";
import { ActionRegistry } from "./action-registry.js";
import { InMemoryActionStore } from "./action-store.js";
import { createChannelComponentStore } from "./component-store.js";
import { MemoryStore } from "./state/memory-store.js";

async function unusedChoice<T>(): Promise<T> {
  throw new Error("awaitChoice is not used by this fixture");
}

async function emptyState<T>(): Promise<T | undefined> {
  return undefined;
}

function interactionContext(id: string): InteractionContext {
  const actor = { id: "user-1", kind: "human" as const };
  const thread: Thread = {
    platform: "slack",
    post: async () => ({ id: "message-1" }),
    update: async (ref) => ref,
    delete: async () => undefined,
    awaitChoice: unusedChoice,
    runAgent: async () => undefined,
    resume: async () => undefined,
    stream: async () => ({ id: "message-1" }),
    postFile: async () => ({ ok: true, fileId: "file-1" }),
    getMessages: async () => [],
    lookupUser: async () => undefined,
    setSuggestedPrompts: async () => ({ ok: true }),
    setTitle: async () => ({ ok: true }),
    react: async () => ({ ok: true }),
    unreact: async () => ({ ok: true }),
    postEphemeral: async () => null,
    subscribe: async () => undefined,
    unsubscribe: async () => undefined,
    isSubscribed: async () => false,
    setState: async () => undefined,
    state: emptyState,
  };
  return {
    thread,
    message: {
      text: "",
      user: null,
      actor,
      ref: { id: "message-1" },
      platform: "slack",
    },
    action: { id, value: "provider-value" },
    values: {},
    user: null,
    actor,
    platform: "slack",
  };
}

function actionId(
  root: Awaited<ReturnType<ActionRegistry["bindComponentRenderable"]>>,
) {
  const handler = root[0]?.props.onClick;
  if (
    typeof handler !== "object" ||
    handler === null ||
    !("id" in handler) ||
    typeof handler.id !== "string"
  ) {
    throw new Error("expected a provider action id");
  }
  return handler.id;
}

function setup() {
  const state = new MemoryStore();
  const componentStore = createChannelComponentStore(state);
  const setState = vi.fn(async () => undefined);
  const onInterrupted = vi.fn(async () => undefined);
  const registry = new ActionRegistry({
    store: new InMemoryActionStore(),
    componentStore,
    componentRuntime: { setState, onInterrupted },
  });
  return { componentStore, onInterrupted, registry, setState };
}

test("named callback dispatch uses the clicked snapshot and fixed bound arguments", async () => {
  const { componentStore, registry, setState } = setup();
  const callback = vi.fn(async (_args, context) => {
    await context.setState({ approved: true });
  });
  registry.registerComponentCallbacks("show_order", { approve: callback });
  await componentStore.putInstance("instance-1", {
    version: 1,
    componentName: "show_order",
    phase: "ready",
    props: { orderId: "newer-order" },
    state: { approved: false },
    revision: 6,
  });
  const root = await registry.bindComponentRenderable(
    <Button
      onClick={createChannelCallbackBinding("approve", {
        reason: "confirmed",
      })}
    >
      Approve
    </Button>,
    {
      componentInstanceId: "instance-1",
      phase: "streaming",
      props: { orderId: "clicked-order" },
      state: { approved: false },
      revision: 3,
    },
  );
  const id = actionId(root);

  await registry.dispatch(id, interactionContext(id));

  expect(callback).toHaveBeenCalledWith(
    { reason: "confirmed" },
    expect.objectContaining({
      phase: "streaming",
      props: { orderId: "clicked-order" },
      state: { approved: false },
      revision: 3,
    }),
  );
  expect(setState).toHaveBeenCalledWith(
    "instance-1",
    { approved: true },
    expect.objectContaining({ message: expect.any(Object) }),
  );
});

test("named callback dispatch keeps a detached nested clicked snapshot", async () => {
  const { componentStore, registry } = setup();
  const callback = vi.fn(async () => undefined);
  registry.registerComponentCallbacks("show_order", { approve: callback });
  const args = { nested: { reason: "confirmed" } };
  const props = { order: { id: "order-42" } };
  const state = { approval: { ready: false } };
  await componentStore.putInstance("instance-1", {
    version: 1,
    componentName: "show_order",
    phase: "ready",
    props,
    state,
    revision: 3,
  });
  const root = await registry.bindComponentRenderable(
    <Button onClick={createChannelCallbackBinding("approve", args)}>
      Approve
    </Button>,
    {
      componentInstanceId: "instance-1",
      phase: "ready",
      props,
      state,
      revision: 3,
    },
  );
  const id = actionId(root);

  args.nested.reason = "mutated";
  props.order.id = "mutated";
  state.approval.ready = true;

  await registry.dispatch(id, interactionContext(id));

  expect(callback).toHaveBeenCalledWith(
    { nested: { reason: "confirmed" } },
    expect.objectContaining({
      props: { order: { id: "order-42" } },
      state: { approval: { ready: false } },
    }),
  );
});

test("a cold interaction lazily fails an abandoned streaming instance", async () => {
  const { componentStore, onInterrupted, registry } = setup();
  const callback = vi.fn(async () => undefined);
  registry.registerComponentCallbacks("show_order", { approve: callback });
  await componentStore.putInstance("instance-1", {
    version: 1,
    componentName: "show_order",
    phase: "streaming",
    props: { orderId: "order-42" },
    revision: 2,
  });
  const root = await registry.bindComponentRenderable(
    <Button onClick={createChannelCallbackBinding("approve", null)}>
      Approve
    </Button>,
    {
      componentInstanceId: "instance-1",
      phase: "streaming",
      props: { orderId: "order-42" },
      revision: 2,
    },
  );
  const id = actionId(root);
  const context = interactionContext(id);

  await registry.dispatch(id, context);

  expect(callback).not.toHaveBeenCalled();
  expect(await componentStore.getInstance("instance-1")).toMatchObject({
    phase: "failed",
    revision: 3,
    error: { code: "channel_component_stream_interrupted" },
  });
  expect(onInterrupted).toHaveBeenCalledWith(
    "instance-1",
    expect.objectContaining({ phase: "failed", revision: 3 }),
    context,
  );
});

test("a live streaming controller can dispatch a named callback immediately", async () => {
  const state = new MemoryStore();
  const componentStore = createChannelComponentStore(state);
  const callback = vi.fn(async () => undefined);
  const registry = new ActionRegistry({
    store: new InMemoryActionStore(),
    componentStore,
    componentRuntime: { isLive: () => true },
  });
  registry.registerComponentCallbacks("show_order", { approve: callback });
  await componentStore.putInstance("instance-1", {
    version: 1,
    componentName: "show_order",
    phase: "streaming",
    props: { orderId: "order-42" },
    revision: 2,
  });
  const root = await registry.bindComponentRenderable(
    <Button onClick={createChannelCallbackBinding("approve", null)}>
      Approve
    </Button>,
    {
      componentInstanceId: "instance-1",
      phase: "streaming",
      props: { orderId: "order-42" },
      revision: 2,
    },
  );
  const id = actionId(root);

  await registry.dispatch(id, interactionContext(id));

  expect(callback).toHaveBeenCalledOnce();
  expect((await componentStore.getInstance("instance-1"))?.phase).toBe(
    "streaming",
  );
});

test("a named callback failure stays separate from component stream failure", async () => {
  const state = new MemoryStore();
  const componentStore = createChannelComponentStore(state);
  const callbackError = new Error("callback failed");
  const onCallbackError = vi.fn(async () => undefined);
  const registry = new ActionRegistry({
    store: new InMemoryActionStore(),
    componentStore,
    componentRuntime: { onCallbackError },
  });
  registry.registerComponentCallbacks("show_order", {
    approve: async () => {
      throw callbackError;
    },
  });
  const snapshot = {
    version: 1 as const,
    componentName: "show_order",
    phase: "ready" as const,
    props: { orderId: "order-42" },
    revision: 2,
  };
  await componentStore.putInstance("instance-1", snapshot);
  const root = await registry.bindComponentRenderable(
    <Button onClick={createChannelCallbackBinding("approve", null)}>
      Approve
    </Button>,
    {
      componentInstanceId: "instance-1",
      phase: "ready",
      props: snapshot.props,
      revision: snapshot.revision,
    },
  );
  const id = actionId(root);
  const context = interactionContext(id);

  await registry.dispatch(id, context);

  expect(onCallbackError).toHaveBeenCalledWith(callbackError, context);
  expect(await componentStore.getInstance("instance-1")).toEqual(snapshot);
});
