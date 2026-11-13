import type { Signal } from "@angular/core";
import type { AbstractAgent } from "@ag-ui/client";
import type { AgentStore } from "./agent";
import type { CopilotChatConfiguration } from "./chat-configuration";
import { explicitEffect } from "./explicit-effect";

/**
 * Opens a connect for `agent` (whose `threadId` the connector has already
 * pinned) and returns a handle that tears it down. The chat component owns
 * the connection's abort, detach and loading state.
 */
export type ConnectFn = (agent: AbstractAgent) => {
  dispose(): void | Promise<void>;
};

/**
 * Wires the active chat thread to the live agent.
 *
 * Reactively observes the resolved thread id (and whether it was chosen
 * explicitly) from {@link CopilotChatConfiguration} and the current agent from
 * the agent-store signal. On every change it pins the thread onto
 * `agent.threadId`, then:
 *
 * - **Explicit switch** (user picked a thread): opens a connect through
 *   {@link ConnectFn} and disposes it on the next effect re-run (thread/agent
 *   switch) and on destroy, so a rapid switch or component destroy does not
 *   leak a prior run.
 * - **Fresh / non-explicit switch** (e.g. {@link CopilotChatConfiguration.startNewThread}):
 *   clears the agent's messages via `agent.setMessages([])` and skips the
 *   connect — the runtime assigns the server thread id on first send. The clear
 *   fires only on an actual transition to a *new* fresh thread id, never on the
 *   initial mount nor on an agent-store swap that leaves the thread id unchanged
 *   (which would otherwise wipe a resumed/shared agent's existing history).
 *
 * The tracked reads are exactly the `explicitEffect` dependency function; all
 * mutation and the connect call run in its untracked body, so they do not
 * register as dependencies.
 *
 * @param config - The chat configuration exposing the resolved thread signals.
 * @param agentStore - Signal yielding the current {@link AgentStore}.
 * @param connect - Opens a connect and returns its tear-down handle.
 */
export function connectActiveThread(
  config: Pick<CopilotChatConfiguration, "threadId" | "hasExplicitThreadId">,
  agentStore: Signal<AgentStore>,
  connect: ConnectFn,
): void {
  // Tracks the thread id observed on the previous effect run so the
  // non-explicit branch can distinguish a genuine new-thread transition from
  // the initial mount (`undefined`) or an agent-store swap that left the thread
  // unchanged. Clearing only on a real transition prevents wiping a
  // resumed/shared agent's existing message history.
  let lastThreadId: string | undefined;
  let lastAgent: AbstractAgent | undefined;
  // Keep teardown ordered across agent swaps, since clones can share cursors.
  let pendingDetach: Promise<void> | undefined;
  explicitEffect(
    () => ({
      threadId: config.threadId(),
      explicit: config.hasExplicitThreadId(),
      store: agentStore(),
    }),
    ({ threadId, explicit, store }, onCleanup) => {
      const agent = store.agent;
      const discardedThreadId =
        lastAgent === agent ? lastThreadId : agent.threadId;
      let active = true;
      let handle: ReturnType<ConnectFn> | undefined;
      agent.threadId = threadId;
      if (explicit) {
        if (pendingDetach) {
          void pendingDetach.then(() => {
            if (active) handle = connect(agent);
          });
        } else {
          handle = connect(agent);
        }
      } else if (lastThreadId !== undefined && threadId !== lastThreadId) {
        const clearCursor = () => {
          if (!discardedThreadId) return;
          if (
            "clearReplayCursor" in agent &&
            typeof agent.clearReplayCursor === "function"
          )
            agent.clearReplayCursor(discardedThreadId);
          if (
            "clearReconnectCursor" in agent &&
            typeof agent.clearReconnectCursor === "function"
          )
            agent.clearReconnectCursor(discardedThreadId);
        };
        const clearBaseline = () => {
          if (!active) return;
          agent.setMessages([]);
          agent.setState({});
          agent.pendingInterrupts = [];
        };
        const detach = pendingDetach ?? agent.detachActiveRun();
        clearCursor();
        clearBaseline();
        const reset = detach.then(() => {
          clearCursor();
          clearBaseline();
        });
        pendingDetach = reset;
        void reset.finally(() => {
          if (pendingDetach === reset) pendingDetach = undefined;
        });
      }
      onCleanup(() => {
        active = false;
        const detached = handle?.dispose();
        if (detached) {
          pendingDetach = detached;
          void detached.finally(() => {
            if (pendingDetach === detached) pendingDetach = undefined;
          });
        }
      });
      lastThreadId = threadId;
      lastAgent = agent;
    },
  );
}
