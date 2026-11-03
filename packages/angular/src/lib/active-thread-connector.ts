import type { Signal } from "@angular/core";
import type { AbstractAgent } from "@ag-ui/client";
import type {
  ɵThreadSelection,
  ɵThreadSwitchCoordinator,
} from "@copilotkit/core";
import type { AgentStore } from "./agent";
import type { CopilotChatConfiguration } from "./chat-configuration";
import { explicitEffect } from "./explicit-effect";

/**
 * Opens a connect for `agent` (whose `threadId` the connector has already
 * pinned) and returns a handle that tears it down. The chat component owns
 * the connection's abort, detach and loading state.
 */
export type ConnectFn = (
  agent: AbstractAgent,
  selection: ɵThreadSelection,
) => {
  dispose(): void | Promise<void>;
};

/**
 * Wires the active chat thread to the live agent.
 *
 * Reactively observes the resolved thread id (and whether it was chosen
 * explicitly) from {@link CopilotChatConfiguration} and the current agent from
 * the agent-store signal, and hands every change to core's
 * `ɵThreadSwitchCoordinator`, which pins the thread on `agent.threadId` and,
 * on a switch to a fresh non-explicit thread (e.g.
 * {@link CopilotChatConfiguration.startNewThread}), empties the agent once its
 * active run has detached. Then:
 *
 * - **Explicit thread** (user picked a thread): opens a connect through
 *   {@link ConnectFn} once earlier teardowns have finished, and disposes it on
 *   the next effect re-run (thread/agent switch) and on destroy, so a rapid
 *   switch or component destroy does not leak a prior run.
 * - **Fresh / non-explicit thread**: skips the connect — the runtime assigns
 *   the server thread id on first send. The initial mount and an agent-store
 *   swap that leaves the thread id unchanged never clear messages.
 *
 * The tracked reads are exactly the `explicitEffect` dependency function; all
 * mutation and the connect call run in its untracked body, so they do not
 * register as dependencies.
 *
 * @param config - The chat configuration exposing the resolved thread signals.
 * @param agentStore - Signal yielding the current {@link AgentStore}.
 * @param connect - Opens a connect and returns its tear-down handle.
 * @param threads - The chat's thread coordinator.
 */
export function connectActiveThread(
  config: Pick<CopilotChatConfiguration, "threadId" | "hasExplicitThreadId">,
  agentStore: Signal<AgentStore>,
  connect: ConnectFn,
  threads: ɵThreadSwitchCoordinator,
): void {
  explicitEffect(
    () => ({
      threadId: config.threadId(),
      explicit: config.hasExplicitThreadId(),
      store: agentStore(),
    }),
    ({ threadId, explicit, store }, onCleanup) => {
      const agent = store.agent;
      const selection = threads.select({ agent, threadId, explicit });
      let handle: ReturnType<ConnectFn> | undefined;
      if (selection.shouldConnect) {
        if (threads.isTornDown) {
          handle = connect(agent, selection);
        } else {
          // Agent clones can share cursors: finish every old reset first.
          void threads.whenTornDown().then(() => {
            if (selection.isCurrent) handle = connect(agent, selection);
          });
        }
      }
      onCleanup(() => {
        selection.release();
        const detached = handle?.dispose();
        if (detached) threads.queueTeardown(detached);
      });
    },
  );
}
