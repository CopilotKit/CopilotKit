import { effect, untracked, type Signal } from "@angular/core";
import { HttpAgent, type AbstractAgent } from "@ag-ui/client";
import type { AgentStore } from "./agent";
import type { CopilotChatConfiguration } from "./chat-configuration";

/**
 * Signature of `CopilotKitCore.connectAgent`, injected for testability.
 *
 * The active thread is carried on `agent.threadId`, which the connector sets
 * before invoking this function; there is no separate thread parameter. The
 * connector receives the raw `core.connectAgent`, not a cursor-wrapping fn —
 * the cursor lifecycle is owned by the connector via {@link ConnectActiveThreadCursorHooks}.
 */
export type ConnectAgentFn = (params: { agent: AbstractAgent }) => unknown;

/**
 * Loading-cursor hooks the connector drives around an explicit connect, with
 * the same timing as the standalone `<copilot-chat>` `connectToAgent` path:
 * cursor on at connect start, off when that connect settles — but only if its
 * run was not superseded by a newer connect (the staleness guard).
 */
export interface ConnectActiveThreadCursorHooks {
  /** Called synchronously when an explicit connect begins (cursor on). */
  onConnectStart?: () => void;
  /** Called when that connect settles, ONLY if its run was not superseded (cursor off). */
  onConnectSettle?: () => void;
}

/**
 * Wires the active chat thread to the live agent.
 *
 * Reactively observes the resolved thread id (and whether it was chosen
 * explicitly) from {@link CopilotChatConfiguration} and the current agent from
 * the agent-store signal. On every change it pins the thread onto
 * `agent.threadId`, then:
 *
 * - **Explicit switch** (user picked a thread): connects the agent to that
 *   thread via {@link ConnectAgentFn}, owning the loading-cursor + abort +
 *   detach lifecycle of the standalone `<copilot-chat>` `connectToAgent` path.
 *   (Connect-error *logging* is the one intentional divergence — see below.)
 *   Before connecting it installs a per-run `AbortController` on the
 *   agent (only when the agent is an {@link HttpAgent}) and calls
 *   {@link ConnectActiveThreadCursorHooks.onConnectStart}. When that connect
 *   settles it calls {@link ConnectActiveThreadCursorHooks.onConnectSettle} —
 *   but only if the run was not superseded (the `detached` staleness guard), so
 *   a stale connect cannot clear the cursor out from under a newer one. The
 *   connect's promise is caught before its `finally` so a rejecting connect
 *   never produces an unhandled rejection. Connect errors surface via the
 *   AgentStore's run/error subscription and are intentionally NOT re-logged here
 *   — the deliberate divergence from `connectToAgent`, which additionally
 *   `console.error`s unexpected (non-`AGUIConnectNotImplementedError`) failures.
 *   On the next effect re-run
 *   (thread/agent switch) and on destroy, the cleanup aborts the in-flight
 *   request via the per-run controller AND detaches the run via
 *   `agent.detachActiveRun()`, mirroring the standalone teardown so a rapid
 *   switch or component destroy does not leak a prior run.
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
 * @param connectAgent - The raw `CopilotKitCore.connectAgent` implementation.
 * @param hooks - Optional loading-cursor hooks driven around the explicit connect.
 */
export function connectActiveThread(
  config: CopilotChatConfiguration,
  agentStore: Signal<AgentStore>,
  connectAgent: ConnectAgentFn,
  hooks?: ConnectActiveThreadCursorHooks,
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
        // Mirror the standalone `connectToAgent` cursor/abort/detach lifecycle:
        // a per-run staleness flag, a per-run AbortController installed on
        // HttpAgents, cursor-on, a single caught connect chain, and an
        // abort+detach cleanup. (Connect-error logging is intentionally omitted
        // here — errors surface via the AgentStore run/error subscription.)
        let detached = false;
        const abortController = new AbortController();
        if (agent instanceof HttpAgent) {
          agent.abortController = abortController;
        }

        hooks?.onConnectStart?.();

        const result = connectAgent({ agent });
        Promise.resolve(result)
          .catch(() => {
            // connect errors surface via the AgentStore's run/error
            // subscription, not here.
          })
          .finally(() => {
            if (!detached) hooks?.onConnectSettle?.();
          });

        // Mirror the standalone `<copilot-chat>` teardown: mark the run stale,
        // abort the in-flight request, and detach the run for the agent
        // connected this run. Fires on the next effect re-run (thread/agent
        // switch) and on destroy so a prior run does not leak.
        onCleanup(() => {
          detached = true;
          abortController.abort();
          agent.detachActiveRun().catch(() => {});
        });
      } else if (lastThreadId !== undefined && threadId !== lastThreadId) {
        // Real switch to a new fresh thread; not mount and not a same-thread swap.
        agent.setMessages([]);
      }
      lastThreadId = threadId;
    });
  });
}
