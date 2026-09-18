import { BaseEvent } from "@ag-ui/client";
import { DebugEventEnvelope, ResolvedDebugConfig } from "@copilotkit/shared";

export type DebugEventListener = (envelope: DebugEventEnvelope) => void;

export class DebugEventBus {
  private listeners = new Set<DebugEventListener>();

  subscribe(listener: DebugEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  broadcast(
    event: BaseEvent,
    metadata: { agentId: string; threadId: string; runId: string },
  ): void {
    if (this.listeners.size === 0) return;

    const envelope: DebugEventEnvelope = {
      timestamp: Date.now(),
      agentId: metadata.agentId,
      threadId: metadata.threadId,
      runId: metadata.runId,
      event,
    };

    for (const listener of this.listeners) {
      try {
        listener(envelope);
      } catch (err) {
        console.warn(
          "[DebugEventBus] Listener error suppressed:",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

/**
 * Whether the `/cpk-debug-events` feed is served.
 *
 * The feed carries every event of every thread, including full message
 * content, to any subscriber — so serving it is an authorization decision, not
 * an environment detail. Two things open it:
 *
 * - `debug` is enabled on the runtime. An explicit opt-in, so it works
 *   wherever the operator asks for it.
 * - `NODE_ENV` is exactly `"development"`. Keeps the zero-configuration VS Code
 *   Inspector flow working under `next dev` and friends.
 *
 * The previous gate asked whether `NODE_ENV !== "production"`, which treats an
 * *unset* `NODE_ENV` as development. A plain `node server.js` sets nothing, so
 * a self-hosted deployment served the feed unless it happened to set the
 * variable. Testing for `"development"` closes that case.
 */
export function isDebugEventFeedEnabled(
  debug: ResolvedDebugConfig | undefined,
): boolean {
  if (debug?.enabled) return true;
  return process.env.NODE_ENV === "development";
}
