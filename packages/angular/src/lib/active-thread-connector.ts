import { effect, untracked } from "@angular/core";
import type { Signal } from "@angular/core";
import type { AbstractAgent } from "@ag-ui/client";
import type { AgentStore } from "./agent";
import type { CopilotChatConfiguration } from "./chat-configuration";

/**
 * Opens a connect for `agent` (whose `threadId` the connector has already
 * pinned) and returns a handle that tears it down. The chat component owns
 * the connection's abort, detach and loading state.
 */
export type ConnectFn = (agent: AbstractAgent) => { dispose(): void };

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
 * Tracked reads happen in the effect's reactive scope; all mutation and the
 * connect call run inside `untracked()` so they do not register as
 * dependencies (mirrors the effect/untracked idiom in `threads.ts`).
 *
 * @param config - The chat configuration exposing the resolved thread signals.
 * @param agentStore - Signal yielding the current {@link AgentStore}.
 * @param connect - Opens a connect and returns its tear-down handle.
 */
export function connectActiveThread(
  config: CopilotChatConfiguration,
  agentStore: Signal<AgentStore>,
  connect: ConnectFn,
): void {
  // Tracks the thread id observed on the previous effect run so the
  // non-explicit branch can distinguish a genuine new-thread transition from
  // the initial mount (`undefined`) or an agent-store swap that left the thread
  // unchanged. Clearing only on a real transition prevents wiping a
  // resumed/shared agent's existing message history.
  let lastThreadId: string | undefined;
  effect((onCleanup) => {
    const threadId = config.threadId();
    const explicit = config.hasExplicitThreadId();
    const store = agentStore();
    untracked(() => {
      const agent = store.agent;
      agent.threadId = threadId;
      if (explicit) {
        const handle = connect(agent);
        onCleanup(() => handle.dispose());
      } else if (lastThreadId !== undefined && threadId !== lastThreadId) {
        // Real switch to a new fresh thread; not mount and not a same-thread swap.
        agent.setMessages([]);
      }
      lastThreadId = threadId;
    });
  });
}
