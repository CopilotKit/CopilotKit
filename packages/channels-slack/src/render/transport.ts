/**
 * The credentialed Slack side-effects the run renderer performs, injected so
 * {@link createRunRenderer} (event-renderer.ts) stays free of `@slack/web-api`
 * (no `WebClient`, no Bolt). The native Slack adapter wraps a real `WebClient`;
 * the managed Connector Outbox wraps its own credentialed sender — both drive
 * the exact same renderer.
 *
 * These are the three ops the renderer calls directly. The four native
 * streaming ops (`chat.startStream`/`appendStream`/`stopStream`) are injected
 * separately as a {@link NativeStreamTransport} (native-stream.ts).
 */
export interface SlackRenderTransport {
  /**
   * `assistant.threads.setStatus` — the thread-anchored "is thinking…" /
   * "is using `tool`…" indicator. Passing an empty `status` clears it.
   */
  setStatus(args: {
    channel_id: string;
    thread_ts: string;
    status: string;
    loading_messages?: string[];
  }): Promise<void>;
  /**
   * `chat.postMessage` — post a message (streaming placeholder, `:wrench:`
   * tool-status row, or error notice). Resolves with the new message `ts`; the
   * legacy text stream treats a missing `ts` as a hard failure.
   */
  postMessage(args: {
    channel: string;
    thread_ts?: string;
    text: string;
  }): Promise<{ ts?: string }>;
  /** `chat.update` — edit an existing message in place. */
  updateMessage(args: {
    channel: string;
    ts: string;
    text: string;
  }): Promise<void>;
}
