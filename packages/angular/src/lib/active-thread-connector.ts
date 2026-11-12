import type { Signal } from "@angular/core";
import type { ɵChatConnection } from "@copilotkit/core";
import type { AgentStore } from "./agent";
import { explicitEffect } from "./explicit-effect";

/** The thread a chat shows, as signals. */
export interface ActiveThreadSource {
  /** The thread id the chat renders. */
  threadId: Signal<string>;
  /** Whether a caller picked the thread, so it exists on the backend. */
  hasExplicitThreadId: Signal<boolean>;
  /** The Inspector override the thread comes from, if any. */
  inspectorRequestId?: Signal<string | null>;
}

/**
 * Wires the active chat thread to the live agent.
 *
 * Hands every change of the thread, its explicitness, the Inspector override
 * or the agent store to core's {@link ɵChatConnection.open}, which pins the
 * thread on the agent, empties the agent on a switch to a fresh thread, and
 * connects an explicit thread once earlier teardowns finish. The handle is
 * released on the next change and on destroy, so a rapid switch or a destroy
 * does not leak a connect.
 *
 * The tracked reads are exactly the `explicitEffect` dependency function; the
 * `open` call runs in its untracked body.
 *
 * @param source - The thread the chat shows.
 * @param agentStore - Signal yielding the current {@link AgentStore}.
 * @param connection - The chat's connection.
 */
export function connectActiveThread(
  source: ActiveThreadSource,
  agentStore: Signal<AgentStore>,
  connection: Pick<ɵChatConnection, "open">,
): void {
  explicitEffect(
    () => ({
      threadId: source.threadId(),
      explicit: source.hasExplicitThreadId(),
      inspectorRequestId: source.inspectorRequestId?.() ?? null,
      store: agentStore(),
    }),
    ({ threadId, explicit, inspectorRequestId, store }, onCleanup) => {
      const handle = connection.open({
        agent: store.agent,
        threadId,
        explicit,
        inspectorRequestId,
      });
      onCleanup(() => handle.release());
    },
  );
}
