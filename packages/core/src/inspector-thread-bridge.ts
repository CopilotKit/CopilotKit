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

type InspectorThreadOverrideState = {
  requestId: string;
  threadId: string;
  agentId: string;
  previousThreadId: string;
};

/** The thread a chat shows because the Inspector asked to view it. */
export type ɵInspectorThreadOverrideSnapshot = {
  threadId: string;
  requestId: string;
} | null;

/** The chat inputs an {@link ɵInspectorThreadOverride} compares against. */
export type ɵInspectorThreadOverrideInput = {
  /** The agent the chat renders. Only matching "view thread" requests apply. */
  agentId: string;
  /** The thread the chat shows when the Inspector does not override it. */
  baseThreadId: string;
};

/**
 * The "view this thread" override a chat applies when the Inspector asks it
 * to show another thread.
 *
 * - A matching view request is claimed, answered with `ok: true`, and the
 *   override replaces the chat's thread. The thread the chat showed before is
 *   kept, so stopping restores it.
 * - The override ends (and the Inspector hears the restored thread) when the
 *   Inspector stops viewing, the chat's agent changes, the chat's own thread
 *   changes to something else, or the connect fails ({@link fail}).
 *
 * Listening to the Inspector starts with the first `subscribe()` and stops
 * when the last subscriber leaves, so a React StrictMode double mount does
 * not leave a listener behind. Development-only, like the bridge.
 */
export class ɵInspectorThreadOverride {
  #input: ɵInspectorThreadOverrideInput;
  #override: InspectorThreadOverrideState | null = null;
  #snapshot: ɵInspectorThreadOverrideSnapshot = null;
  readonly #listeners = new Set<() => void>();
  #disconnect: (() => void) | null = null;

  constructor(input: ɵInspectorThreadOverrideInput) {
    this.#input = input;
  }

  /** The current override, or `null`. Same object until it changes. */
  getSnapshot = () => this.#snapshot;

  /** Listen for override changes. Returns unsubscribe. */
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) this.#connect();
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) this.#disconnectBridge();
    };
  };

  /** Give the chat's current agent and thread; ends a stale override. */
  update(input: ɵInspectorThreadOverrideInput) {
    this.#input = input;
    this.#restoreIfStale();
  }

  /**
   * Report that connecting to the overriding thread failed: the Inspector
   * gets `ok: false` with `connect-failed`, and the previous thread returns.
   * Ignored when `requestId` is not the current override.
   */
  fail = (requestId: string) => {
    const current = this.#override;
    if (!current || current.requestId !== requestId) return;
    emitInspectorViewThreadResult({
      requestId,
      threadId: current.threadId,
      agentId: current.agentId,
      ok: false,
      reason: "connect-failed",
    });
    this.#restore(current, current.previousThreadId);
  };

  dispose() {
    this.#disconnectBridge();
    this.#listeners.clear();
  }

  #connect() {
    if (!isInspectorThreadBridgeEnabled()) return;
    const offView = onInspectorViewThread((payload) => {
      if (payload.agentId !== this.#input.agentId) return false;
      this.#setOverride(
        this.#override
          ? { ...this.#override, ...payload }
          : { ...payload, previousThreadId: this.#input.baseThreadId },
      );
      emitInspectorViewThreadResult({ ...payload, ok: true });
      emitInspectorActiveThread({ ...payload, source: "override" });
      this.#restoreIfStale();
      return true;
    });
    const offStop = onInspectorStopViewing((payload) => {
      const current = this.#override;
      if (!current) return;
      const isCurrentRequest =
        payload.requestId === current.requestId &&
        payload.agentId === current.agentId;
      if (!isCurrentRequest) return;
      this.#restore(current, current.previousThreadId);
    });
    this.#disconnect = () => {
      offView();
      offStop();
    };
  }

  #disconnectBridge() {
    this.#disconnect?.();
    this.#disconnect = null;
  }

  #restoreIfStale() {
    const current = this.#override;
    if (!current) return;
    const { agentId, baseThreadId } = this.#input;
    if (agentId !== current.agentId) {
      this.#restore(current, current.previousThreadId);
      return;
    }
    const isBaseUnchanged =
      baseThreadId === current.previousThreadId ||
      baseThreadId === current.threadId;
    if (isBaseUnchanged) return;
    this.#restore(current, baseThreadId);
  }

  #restore(current: InspectorThreadOverrideState, nextThreadId: string) {
    this.#setOverride(null);
    emitInspectorActiveThread({
      requestId: current.requestId,
      threadId: nextThreadId,
      agentId: current.agentId,
      source: "app",
    });
  }

  #setOverride(next: InspectorThreadOverrideState | null) {
    this.#override = next;
    this.#snapshot = next
      ? { threadId: next.threadId, requestId: next.requestId }
      : null;
    const listeners = [...this.#listeners];
    for (const listener of listeners) listener();
  }
}
