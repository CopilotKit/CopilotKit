import type { BaseEvent } from "@ag-ui/client";
import type {
  DebugEventEnvelope,
  ResolvedDebugConfig,
} from "@copilotkit/shared";

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
 * an environment detail. Three things open it:
 *
 * - `exposeDebugEvents: true`, the explicit opt-in, under any `NODE_ENV`.
 * - `NODE_ENV` is exactly `"development"`. Keeps the zero-configuration VS Code
 *   Inspector flow working under `next dev` and friends.
 * - `debug` is enabled and `NODE_ENV` is exactly `"test"`.
 *
 * `debug` opens nothing under any other value, unset, `"prod"`, `"staging"` and
 * empty included: it also turns on logging, which a deployed runtime can want
 * without publishing every thread.
 *
 * The previous gate asked whether `NODE_ENV !== "production"`, which treats an
 * *unset* `NODE_ENV` as development. A plain `node server.js` sets nothing, so
 * a self-hosted deployment served the feed unless it happened to set the
 * variable. Testing for `"development"` closes that case.
 */
export function isDebugEventFeedEnabled(
  debug: ResolvedDebugConfig | undefined,
  exposeDebugEvents?: boolean,
): boolean {
  if (exposeDebugEvents === true) return true;
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "development") return true;
  return nodeEnv === "test" && debug?.enabled === true;
}

let exposedFeedWarned = false;

/** Re-arm the once-per-process warning. Internal: for tests. */
export function ɵresetDebugEventFeedWarning(): void {
  exposedFeedWarned = false;
}

/** Log once per process when the feed is served outside development and test. */
export function warnIfDebugEventFeedExposed(): void {
  const nodeEnv = process.env.NODE_ENV;
  if (exposedFeedWarned || nodeEnv === "development" || nodeEnv === "test") {
    return;
  }
  exposedFeedWarned = true;
  console.warn(
    "[CopilotKit] exposeDebugEvents is on outside development and test: " +
      "/cpk-debug-events streams every thread's events, including full message " +
      "content, to any caller that reaches the route. Restrict the route, or " +
      "remove the option when you finish debugging.",
  );
}
