/**
 * `@copilotkit/channels-slack/render` — the pure, Bolt-free Slack rendering surface.
 *
 * Nothing here imports `@slack/bolt` or instantiates a `WebClient`: the
 * stateful run renderer takes its credentialed side-effects as injected
 * transports ({@link SlackRenderTransport} + {@link NativeStreamTransport}), and
 * the IR→Block Kit / modal / mrkdwn helpers are pure functions. This is the
 * seam the native Slack adapter AND the managed Connector Outbox both consume,
 * so managed replies reach 1:1 UX parity with the native bot without forking
 * the renderer.
 */
export { createRunRenderer } from "./event-renderer.js";
export type { SlackRenderTransport } from "./render/transport.js";

export {
  renderBlockKit,
  renderSlackMessage,
  buildFeedbackBlocks,
  FEEDBACK_ACTION_ID,
} from "./render/block-kit.js";
export { renderSlackModal } from "./render/modal.js";
export { SLACK_LIMITS } from "./render/budget.js";

export { NativeMessageStream } from "./native-stream.js";
export { ChunkedMessageStream } from "./chunked-message-stream.js";
export { MessageStream } from "./message-stream.js";
export type {
  NativeMessageStreamConfig,
  NativeStreamTransport,
  TextStream,
} from "./native-stream.js";

export { markdownToMrkdwn } from "./markdown-to-mrkdwn.js";
export { autoCloseOpenMarkdown } from "./auto-close-streaming.js";
