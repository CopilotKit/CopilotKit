/** Connection-local hooks; never part of AG-UI events or persisted history. */
export interface ConnectionReplayLifecycle {
  /** Called before delivering history, including each reconnect replay. */
  onReplayStarted?: () => void;
  /** Called after ALL buffered events (including an active run), before live events.
   * Empty history must finish too. Call synchronously at the delivery boundary,
   * not when history is fetched or queued. Stop invoking hooks after unsubscribe.
   * Runners without these hooks retain the legacy wait-for-close behavior.
   */
  onReplayFinished?: () => void;
}

/** Named SSE transport controls, consumed before AG-UI decoding. */
export const CONNECTION_REPLAY_STARTED = "copilotkit.connection.replay.started";
export const CONNECTION_REPLAY_FINISHED =
  "copilotkit.connection.replay.finished";
/** Opt in on /connect only; older clients cannot consume transport controls. */
export const CONNECTION_REPLAY_ACCEPT =
  "text/event-stream; copilotkit-replay=2";
