export const INSPECTOR_THREAD_BRIDGE_PLUGIN_ID =
  "cpk-inspector-thread" as const;

const EVENT_PREFIX = `copilotkit:${INSPECTOR_THREAD_BRIDGE_PLUGIN_ID}`;

type InspectorBridgeGlobal = typeof globalThis & {
  __COPILOTKIT_INSPECTOR_THREAD_EVENT_TARGET__?: EventTarget;
};

export type InspectorViewThreadPayload = {
  requestId: string;
  threadId: string;
  agentId: string;
};

export type InspectorStopViewingPayload = {
  requestId: string;
  agentId: string;
};

export type InspectorActiveThreadPayload = {
  requestId: string;
  threadId: string;
  agentId: string;
  source: "app" | "override";
};

export type InspectorViewThreadResultPayload =
  | {
      requestId: string;
      threadId: string;
      agentId: string;
      ok: true;
    }
  | {
      requestId: string;
      threadId: string;
      agentId: string;
      ok: false;
      reason: "connect-failed";
    };

type InspectorThreadBridgeEvents = {
  "stop-viewing": InspectorStopViewingPayload;
  "active-thread": InspectorActiveThreadPayload;
  "view-thread-result": InspectorViewThreadResultPayload;
};

type ClaimableViewThreadEvent = {
  payload: InspectorViewThreadPayload;
  claimed: boolean;
};

function eventName(suffix: string): string {
  return `${EVENT_PREFIX}:${suffix}`;
}

function getEventTarget(): EventTarget | null {
  if (
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  ) {
    return window;
  }
  if (typeof EventTarget === "undefined") return null;
  // Shared by duplicate @copilotkit/core copies in non-browser test realms.
  // Browser copies use window itself as the shared event target.
  const sharedGlobal = globalThis as InspectorBridgeGlobal;
  sharedGlobal.__COPILOTKIT_INSPECTOR_THREAD_EVENT_TARGET__ ??=
    new EventTarget();
  return sharedGlobal.__COPILOTKIT_INSPECTOR_THREAD_EVENT_TARGET__;
}

function createDetailEvent<T>(name: string, detail: T): Event {
  if (typeof CustomEvent !== "undefined") {
    return new CustomEvent(name, { detail });
  }
  const event = new Event(name);
  Object.defineProperty(event, "detail", { value: detail });
  return event;
}

function detailFromEvent<T>(event: Event): T {
  return (event as Event & { detail: T }).detail;
}

/** The Inspector thread bridge is development-only. */
export function isInspectorThreadBridgeEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function createInspectorThreadRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `inspector-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function dispatch<K extends keyof InspectorThreadBridgeEvents>(
  suffix: K,
  payload: InspectorThreadBridgeEvents[K],
): void {
  if (!isInspectorThreadBridgeEnabled()) return;
  const target = getEventTarget();
  if (!target) return;
  target.dispatchEvent(createDetailEvent(eventName(suffix), payload));
}

function on<K extends keyof InspectorThreadBridgeEvents>(
  suffix: K,
  handler: (payload: InspectorThreadBridgeEvents[K]) => void,
): () => void {
  if (!isInspectorThreadBridgeEnabled()) return () => undefined;
  const target = getEventTarget();
  if (!target) return () => undefined;
  const listener = (event: Event) => {
    handler(detailFromEvent<InspectorThreadBridgeEvents[K]>(event));
  };
  const name = eventName(suffix);
  target.addEventListener(name, listener);
  return () => target.removeEventListener(name, listener);
}

/**
 * Ask the first mounted official chat for the matching agent to load a thread.
 * Returns false when no chat claims the request synchronously.
 */
export function emitInspectorViewThread(
  payload: InspectorViewThreadPayload,
): boolean {
  if (!isInspectorThreadBridgeEnabled()) return false;
  const target = getEventTarget();
  if (!target) return false;
  const detail: ClaimableViewThreadEvent = { payload, claimed: false };
  target.dispatchEvent(createDetailEvent(eventName("view-thread"), detail));
  return detail.claimed;
}

export function emitInspectorStopViewing(
  payload: InspectorStopViewingPayload,
): void {
  dispatch("stop-viewing", payload);
}

export function emitInspectorActiveThread(
  payload: InspectorActiveThreadPayload,
): void {
  dispatch("active-thread", payload);
}

export function emitInspectorViewThreadResult(
  payload: InspectorViewThreadResultPayload,
): void {
  dispatch("view-thread-result", payload);
}

export function onInspectorViewThread(
  handler: (payload: InspectorViewThreadPayload) => boolean,
): () => void {
  if (!isInspectorThreadBridgeEnabled()) return () => undefined;
  const target = getEventTarget();
  if (!target) return () => undefined;
  const listener = (event: Event) => {
    const detail = detailFromEvent<ClaimableViewThreadEvent>(event);
    if (detail.claimed) return;
    detail.claimed = handler(detail.payload);
  };
  const name = eventName("view-thread");
  target.addEventListener(name, listener);
  return () => target.removeEventListener(name, listener);
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
