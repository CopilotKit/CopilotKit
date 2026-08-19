import { EventClient } from "@tanstack/devtools-event-client";

export const INSPECTOR_THREAD_BRIDGE_PLUGIN_ID =
  "cpk-inspector-thread" as const;

export type InspectorViewThreadPayload = {
  threadId: string;
  agentId: string;
};

export type InspectorStopViewingPayload = {
  agentId: string;
};

export type InspectorActiveThreadPayload = {
  threadId: string;
  agentId: string;
  source: "app" | "override";
};

export type InspectorViewThreadResultPayload =
  | {
      threadId: string;
      agentId: string;
      ok: true;
    }
  | {
      threadId: string;
      agentId: string;
      ok: false;
      reason: "no-matching-chat" | "connect-failed" | "bus-unavailable";
    };

type InspectorThreadBridgeEvents = {
  "view-thread": InspectorViewThreadPayload;
  "stop-viewing": InspectorStopViewingPayload;
  "active-thread": InspectorActiveThreadPayload;
  "view-thread-result": InspectorViewThreadResultPayload;
};

class InspectorThreadBridgeClient extends EventClient<InspectorThreadBridgeEvents> {
  constructor() {
    super({ pluginId: INSPECTOR_THREAD_BRIDGE_PLUGIN_ID });
  }
}

const localBus = new EventTarget();

let client: InspectorThreadBridgeClient | null = null;

function getClient(): InspectorThreadBridgeClient {
  if (!client) {
    client = new InspectorThreadBridgeClient();
  }
  return client;
}

function nodeEnv(): string | undefined {
  return process.env.NODE_ENV;
}

/**
 * The action and bus are for development. A production build hides both.
 * EventClient from the root import is a no-op outside `development`.
 */
export function isInspectorThreadBridgeEnabled(): boolean {
  return nodeEnv() !== "production";
}

function useLocalFallback(): boolean {
  return nodeEnv() !== "development";
}

function emit<K extends keyof InspectorThreadBridgeEvents>(
  suffix: K,
  payload: InspectorThreadBridgeEvents[K],
): void {
  if (!isInspectorThreadBridgeEnabled()) return;
  getClient().emit(suffix, payload);
  if (useLocalFallback()) {
    localBus.dispatchEvent(new CustomEvent(suffix, { detail: payload }));
  }
}

function on<K extends keyof InspectorThreadBridgeEvents>(
  suffix: K,
  handler: (payload: InspectorThreadBridgeEvents[K]) => void,
): () => void {
  if (!isInspectorThreadBridgeEnabled()) return () => undefined;
  const offClient = getClient().on(
    suffix,
    (event) => {
      handler(event.payload);
    },
    { withEventTarget: true },
  );
  if (!useLocalFallback()) {
    return offClient;
  }
  const localHandler = (event: Event) => {
    handler((event as CustomEvent<InspectorThreadBridgeEvents[K]>).detail);
  };
  localBus.addEventListener(suffix, localHandler);
  return () => {
    offClient();
    localBus.removeEventListener(suffix, localHandler);
  };
}

export function emitInspectorViewThread(
  payload: InspectorViewThreadPayload,
): void {
  emit("view-thread", payload);
}

export function emitInspectorStopViewing(
  payload: InspectorStopViewingPayload,
): void {
  emit("stop-viewing", payload);
}

export function emitInspectorActiveThread(
  payload: InspectorActiveThreadPayload,
): void {
  emit("active-thread", payload);
}

export function emitInspectorViewThreadResult(
  payload: InspectorViewThreadResultPayload,
): void {
  emit("view-thread-result", payload);
}

export function onInspectorViewThread(
  handler: (payload: InspectorViewThreadPayload) => void,
): () => void {
  return on("view-thread", handler);
}

export function onInspectorStopViewing(
  handler: (payload: InspectorStopViewingPayload) => void,
): () => void {
  return on("stop-viewing", handler);
}

export function onInspectorActiveThread(
  handler: (payload: InspectorActiveThreadPayload) => void,
): () => void {
  return on("active-thread", handler);
}

export function onInspectorViewThreadResult(
  handler: (payload: InspectorViewThreadResultPayload) => void,
): () => void {
  return on("view-thread-result", handler);
}
