import type {
  CopilotKitCore,
  ɵThreadSelectionInput,
  ɵThreadSwitchCoordinator,
} from "@copilotkit/core";
import { ɵisHttpAgent } from "@copilotkit/core";

/** What {@link showThread} works with. */
export interface ShowThreadOptions {
  /** The chat's thread coordinator. */
  threads: ɵThreadSwitchCoordinator;
  /** The CopilotKit core that connects the agent. */
  core: Pick<CopilotKitCore, "connectAgent">;
  /** The agent and thread the chat now shows. */
  input: ɵThreadSelectionInput;
  /**
   * Whether the thread the chat shows NOW is one a caller picked. Read after
   * a connect was superseded, so a switch to a fresh thread clears what that
   * connect applied.
   */
  isExplicitNow: () => boolean;
}

/**
 * Shows a thread in the chat: pins it on the agent through the coordinator
 * and, for a thread a caller picked, restores it from the backend with
 * `connectAgent` once the previous thread is torn down. A send waits for that
 * connection. Returns the cleanup for the chat's effect: it releases the
 * selection, aborts the connect, and detaches the active run.
 *
 * This is the only place React Native wires a thread connect. When core's
 * `ɵThreadSwitchCoordinator` offers a higher-level connect, switch this
 * function to it.
 */
export function showThread({
  threads,
  core,
  input,
  isExplicitNow,
}: ShowThreadOptions) {
  const selection = threads.select(input);
  // A thread the caller did not pick is a locally minted id the backend has
  // never seen, so `/connect` would 404.
  if (!selection.shouldConnect) return () => selection.release();

  const { agent } = selection;
  let stopped = false;
  // `connectAgent` does not make its own AbortController the way `runAgent`
  // does, so give the HTTP agent one that the cleanup can abort.
  const abortController = new AbortController();
  void threads.trackConnection(selection, async () => {
    try {
      await threads.whenTornDown();
      if (stopped) return;
      if (ɵisHttpAgent(agent)) agent.abortController = abortController;
      await core.connectAgent({ agent });
    } catch (error) {
      // A connect aborted by the cleanup is not a failure.
      if (!stopped) throw error;
    } finally {
      // Superseded while loading by a fresh thread: clear what this connect
      // applied, so the fresh thread shows empty. Another picked thread
      // resets the messages through its own connect.
      if (stopped && !isExplicitNow()) selection.clearDiscardedBaseline();
    }
  });

  return () => {
    selection.release();
    stopped = true;
    abortController.abort();
    void threads.detach(agent);
  };
}
