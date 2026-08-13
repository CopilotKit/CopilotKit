import type { StateStore } from "./state/state-store.js";
import {
  COMPONENT_BINDINGS_MAX_BYTES,
  COMPONENT_BINDING_MAX_BYTES,
  JsonValueError,
  assertComponentProps,
  assertComponentState,
  assertJsonValue,
  jsonByteLength,
  snapshotJsonValue,
} from "./json-value.js";
import type { JsonValue } from "./json-value.js";

/** A component phase that may contain interactive callback bindings. */
export type ChannelComponentInteractivePhase = "streaming" | "ready";

/** A structured failure that can be passed to a component failed render. */
export interface ChannelComponentErrorSnapshot {
  code: string;
  message: string;
  index?: number;
  line?: number;
  column?: number;
  limit?: number;
  observed?: number;
}

/** Durable current state for one component instance. */
export interface ChannelComponentInstanceSnapshot {
  version: 1;
  componentName: string;
  phase: ChannelComponentInteractivePhase | "failed";
  props: JsonValue;
  state?: JsonValue;
  revision: number;
  error?: ChannelComponentErrorSnapshot;
}

/** Durable exact render snapshot attached to one provider callback capability. */
export interface ChannelComponentBindingSnapshot {
  version: 1;
  componentInstanceId: string;
  callbackName: string;
  args: JsonValue;
  phase: ChannelComponentInteractivePhase;
  props: JsonValue;
  state?: JsonValue;
  revision: number;
}

/** Binding record paired with the opaque action ID placed in provider JSX. */
export interface PendingChannelComponentBinding {
  id: string;
  record: ChannelComponentBindingSnapshot;
}

/** No-TTL component persistence over the existing StateStore KV facet. */
export interface ChannelComponentStore {
  getInstance(
    id: string,
  ): Promise<ChannelComponentInstanceSnapshot | undefined>;
  putInstance(
    id: string,
    snapshot: ChannelComponentInstanceSnapshot,
  ): Promise<void>;
  getBinding(id: string): Promise<ChannelComponentBindingSnapshot | undefined>;
  putBindings(
    bindings: readonly PendingChannelComponentBinding[],
  ): Promise<void>;
  failInterrupted(
    id: string,
  ): Promise<ChannelComponentInstanceSnapshot | undefined>;
}

/** Return the versioned KV key for one component instance. */
export function componentInstanceKey(id: string): string {
  return `channel-component:v1:instance:${id}`;
}

/** Return the versioned KV key for one component callback capability. */
export function componentBindingKey(id: string): string {
  return `channel-component:v1:binding:${id}`;
}

/** Create durable no-expiry storage for component instances and bindings. */
export function createChannelComponentStore(
  state: StateStore,
): ChannelComponentStore {
  const getInstance = async (id: string) => {
    const snapshot = await state.kv.get<ChannelComponentInstanceSnapshot>(
      componentInstanceKey(id),
    );
    return snapshot ? immutableInstanceSnapshot(snapshot) : undefined;
  };

  return {
    getInstance,
    async putInstance(id, snapshot) {
      assertInstanceSnapshot(snapshot);
      await state.kv.set(
        componentInstanceKey(id),
        immutableInstanceSnapshot(snapshot),
      );
    },
    async getBinding(id) {
      const binding = await state.kv.get<ChannelComponentBindingSnapshot>(
        componentBindingKey(id),
      );
      return binding ? immutableBindingSnapshot(binding) : undefined;
    },
    async putBindings(bindings) {
      for (const { id, record } of bindings) {
        assertBindingIdentity(id, record);
      }
      const ids = new Set(bindings.map(({ id }) => id));
      if (ids.size !== bindings.length) {
        throw new TypeError(
          "Component binding IDs must be unique per revision.",
        );
      }
      const totalBytes = bindings.reduce(
        (total, binding) => total + bindingPayloadBytes(binding.record),
        0,
      );
      if (totalBytes > COMPONENT_BINDINGS_MAX_BYTES) {
        throw new JsonValueError(
          "channel_component_bindings_too_large",
          `Component bindings are ${totalBytes} bytes; the limit is ${COMPONENT_BINDINGS_MAX_BYTES} bytes.`,
          { limit: COMPONENT_BINDINGS_MAX_BYTES, observed: totalBytes },
        );
      }
      await Promise.all(
        bindings.map(({ id, record }) =>
          state.kv.set(
            componentBindingKey(id),
            immutableBindingSnapshot(record),
          ),
        ),
      );
    },
    async failInterrupted(id) {
      const snapshot = await getInstance(id);
      if (!snapshot || snapshot.phase !== "streaming") return snapshot;
      const failed: ChannelComponentInstanceSnapshot = {
        ...snapshot,
        phase: "failed",
        revision: snapshot.revision + 1,
        error: {
          code: "channel_component_stream_interrupted",
          message: "Component streaming was interrupted before completion.",
        },
      };
      assertInstanceSnapshot(failed);
      const immutable = immutableInstanceSnapshot(failed);
      await state.kv.set(componentInstanceKey(id), immutable);
      return immutable;
    },
  };
}

function immutableInstanceSnapshot(
  snapshot: ChannelComponentInstanceSnapshot,
): ChannelComponentInstanceSnapshot {
  assertInstanceSnapshot(snapshot);
  return snapshotJsonValue(snapshot, {
    label: "Component instance snapshot",
  }) as ChannelComponentInstanceSnapshot;
}

function immutableBindingSnapshot(
  snapshot: ChannelComponentBindingSnapshot,
): ChannelComponentBindingSnapshot {
  assertBindingIdentity("ck:snapshot", snapshot);
  return snapshotJsonValue(snapshot, {
    label: "Component binding snapshot",
  }) as ChannelComponentBindingSnapshot;
}

function assertInstanceSnapshot(
  snapshot: ChannelComponentInstanceSnapshot,
): void {
  assertSnapshotHeader(snapshot.version, snapshot.revision);
  if (snapshot.componentName.trim().length === 0) {
    throw new TypeError("Component snapshot name must not be empty.");
  }
  assertComponentProps(snapshot.props);
  if (snapshot.state !== undefined) assertComponentState(snapshot.state);
  if (snapshot.error !== undefined) {
    assertJsonValue(snapshot.error, { label: "Component error" });
  }
}

function assertBindingIdentity(
  id: string,
  record: ChannelComponentBindingSnapshot,
): void {
  assertSnapshotHeader(record.version, record.revision);
  if (!id.startsWith("ck:") || record.callbackName.trim().length === 0) {
    throw new TypeError(
      "Component binding ID and callback name must be valid.",
    );
  }
  assertJsonValue(bindingPayload(record), {
    label: "Component callback binding",
    maxBytes: COMPONENT_BINDING_MAX_BYTES,
    tooLargeCode: "channel_component_binding_too_large",
  });
  assertComponentProps(record.props);
  if (record.state !== undefined) assertComponentState(record.state);
  assertJsonValue(record, { label: "Component binding record" });
}

function bindingPayload(record: ChannelComponentBindingSnapshot): JsonValue {
  return {
    callbackName: record.callbackName,
    args: record.args,
  };
}

function bindingPayloadBytes(record: ChannelComponentBindingSnapshot): number {
  return jsonByteLength(bindingPayload(record));
}

function assertSnapshotHeader(version: 1, revision: number): void {
  if (version !== 1 || !Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError("Component snapshot version or revision is invalid.");
  }
}
