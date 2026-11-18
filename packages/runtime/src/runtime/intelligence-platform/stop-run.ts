import { Socket } from "phoenix";

/** The thread channel command a browser's Stop sends. */
const STOP_RUN_EVENT = "stop_run";

/**
 * Sends `stop_run` for one run on its thread's client channel, the message a
 * browser's Stop sends, and resolves once Intelligence acknowledges it.
 *
 * Intelligence answers by storing the stop for the run and relaying it to the
 * run's runner. The join token is single use, so the socket is closed after
 * the one command and never reconnects.
 *
 * @throws when the socket, the join or the command is refused or unanswered,
 *   or when `signal` aborts.
 */
export function sendStopRun(params: {
  /** The Intelligence client websocket URL (`.../client`). */
  url: string;
  /** A fresh thread join token, as `POST /api/threads/:id/connect` mints it. */
  joinToken: string;
  threadId: string;
  runId: string;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (params.signal?.aborted) {
      reject(new Error("Stopped before the stop could be sent"));
      return;
    }
    const socket = new Socket(params.url, {
      params: { join_token: params.joinToken },
    });
    const channel = socket.channel(`thread:${params.threadId}`, {
      stream_mode: "run",
      run_id: params.runId,
    });

    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      params.signal?.removeEventListener("abort", onAbort);
      channel.leave();
      socket.disconnect();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () =>
      finish(new Error("Stopped waiting for Intelligence to record the stop"));
    params.signal?.addEventListener("abort", onAbort, { once: true });

    socket.onError(() =>
      finish(new Error("Could not reach Intelligence to record the stop")),
    );
    channel
      .join()
      .receive("ok", () => {
        channel
          .push(STOP_RUN_EVENT, { run_id: params.runId })
          .receive("ok", () => finish())
          .receive("error", () =>
            finish(new Error("Intelligence refused the stop")),
          )
          .receive("timeout", () =>
            finish(new Error("Intelligence did not answer the stop")),
          );
      })
      .receive("error", () =>
        finish(new Error("Intelligence refused the thread channel")),
      )
      .receive("timeout", () =>
        finish(new Error("Intelligence did not answer the thread channel")),
      );
    socket.connect();
  });
}
