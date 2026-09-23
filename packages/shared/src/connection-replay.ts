/**
 * Transport-level connection lifecycle events, carried as AG-UI CUSTOM events.
 * These are connection-local controls: never persist them in a run's history.
 *
 * A connect stream starts in replay mode. Emit STARTED again before replaying
 * on a reconnect, and FINISHED after all buffered history (including any active
 * run's buffered events), before delivering live events. Empty history still
 * requires FINISHED. Custom runners can emit the same controls over SSE.
 *
 * Clients that do not receive these controls retain legacy behavior: wait for
 * the connect stream to close rather than treating historical errors as live.
 */
export const CONNECTION_REPLAY_STARTED = "copilotkit.connection.replay.started";
export const CONNECTION_REPLAY_FINISHED =
  "copilotkit.connection.replay.finished";

/** Opt in on /connect only; older clients cannot consume lifecycle controls. */
export const CONNECTION_REPLAY_ACCEPT =
  "text/event-stream; copilotkit-replay=1";
