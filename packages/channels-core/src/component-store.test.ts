import { expect, test, vi } from "vitest";
import { createChannelCallbackBinding } from "@copilotkit/channels-ui";
import { MemoryStore } from "./state/memory-store.js";
import {
  componentBindingKey,
  componentInstanceKey,
  createChannelComponentStore,
} from "./component-store.js";
import type {
  ChannelComponentBindingSnapshot,
  ChannelComponentInstanceSnapshot,
} from "./component-store.js";

function setup() {
  const state = new MemoryStore();
  const set = vi.spyOn(state.kv, "set");
  const store = createChannelComponentStore(state);
  return { state, set, store };
}

test("component instance snapshots use a versioned key and no TTL", async () => {
  const { set, store } = setup();
  const snapshot: ChannelComponentInstanceSnapshot = {
    version: 1,
    componentName: "show_order",
    phase: "ready",
    props: { orderId: "order-42" },
    state: { approved: false },
    revision: 4,
  };

  await store.putInstance("instance-1", snapshot);

  expect(await store.getInstance("instance-1")).toEqual(snapshot);
  expect(set).toHaveBeenCalledWith(
    componentInstanceKey("instance-1"),
    snapshot,
  );
});

test("component instance snapshots reject props and state that are not JSON-safe", async () => {
  const { set, store } = setup();

  await expect(
    store.putInstance("instance-1", {
      version: 1,
      componentName: "show_order",
      phase: "ready",
      props: { orderId: undefined } as never,
      revision: 1,
    }),
  ).rejects.toMatchObject({ code: "channel_component_json_invalid" });
  await expect(
    store.putInstance("instance-1", {
      version: 1,
      componentName: "show_order",
      phase: "ready",
      props: {},
      state: { count: Number.NaN },
      revision: 1,
    }),
  ).rejects.toMatchObject({ code: "channel_component_json_invalid" });
  expect(set).not.toHaveBeenCalled();
});

test("component binding records capture the clicked revision without a TTL", async () => {
  const { set, store } = setup();
  const record: ChannelComponentBindingSnapshot = {
    version: 1,
    componentInstanceId: "instance-1",
    callbackName: "approve",
    args: { reason: "looks-good" },
    phase: "streaming",
    props: { orderId: "order-42" },
    state: { approved: false },
    revision: 3,
  };

  await store.putBindings([{ id: "ck:binding-1", record }]);

  expect(await store.getBinding("ck:binding-1")).toEqual(record);
  expect(set).toHaveBeenCalledWith(componentBindingKey("ck:binding-1"), record);
});

test("binding validation rejects one argument payload over 4 KiB before writing", async () => {
  const { set, store } = setup();
  const binding = createChannelCallbackBinding("approve", {
    reason: "x".repeat(4 * 1024),
  });
  const record: ChannelComponentBindingSnapshot = {
    version: 1,
    componentInstanceId: "instance-1",
    callbackName: binding.callbackName,
    args: binding.args,
    phase: "ready",
    props: {},
    revision: 1,
  };

  await expect(
    store.putBindings([{ id: "ck:binding-1", record }]),
  ).rejects.toMatchObject({ code: "channel_component_binding_too_large" });
  expect(set).not.toHaveBeenCalled();
});

test("binding validation rejects an aggregate render payload over 16 KiB", async () => {
  const { set, store } = setup();
  const records = Array.from({ length: 5 }, (_, index) => ({
    id: `ck:binding-${index}`,
    record: {
      version: 1 as const,
      componentInstanceId: "instance-1",
      callbackName: "approve",
      args: { reason: "x".repeat(3_500) },
      phase: "ready" as const,
      props: {},
      revision: 1,
    },
  }));

  await expect(store.putBindings(records)).rejects.toMatchObject({
    code: "channel_component_bindings_too_large",
  });
  expect(set).not.toHaveBeenCalled();
});

test("binding persistence rejects duplicate action IDs before writing", async () => {
  const { set, store } = setup();
  const record: ChannelComponentBindingSnapshot = {
    version: 1,
    componentInstanceId: "instance-1",
    callbackName: "approve",
    args: null,
    phase: "ready",
    props: {},
    revision: 1,
  };

  await expect(
    store.putBindings([
      { id: "ck:duplicate", record },
      { id: "ck:duplicate", record },
    ]),
  ).rejects.toThrow("Component binding IDs must be unique per revision.");
  expect(set).not.toHaveBeenCalled();
});

test("loading an abandoned streaming instance marks it failed once", async () => {
  const { store } = setup();
  await store.putInstance("instance-1", {
    version: 1,
    componentName: "show_order",
    phase: "streaming",
    props: { orderId: "order" },
    revision: 3,
  });

  const failed = await store.failInterrupted("instance-1");
  const unchanged = await store.failInterrupted("instance-1");

  expect(failed).toEqual({
    version: 1,
    componentName: "show_order",
    phase: "failed",
    props: { orderId: "order" },
    revision: 4,
    error: {
      code: "channel_component_stream_interrupted",
      message: "Component streaming was interrupted before completion.",
    },
  });
  expect(unchanged).toEqual(failed);
});
