import type { GitHubComment } from "./types.js";

/**
 * Hidden HTML comment at the end of every comment the adapter writes. GitHub
 * does not render it. It tells the adapter's own comments apart from human
 * comments by the same account, for example when the token is a person's own
 * personal access token.
 */
export const BOT_MARKER = "<!-- copilotkit-channels -->";

const MARKER_SUFFIX = `\n\n${BOT_MARKER}`;

/** Characters {@link withBotMarker} adds to a body. */
export const BOT_MARKER_LENGTH = MARKER_SUFFIX.length;

/** `body` with the hidden bot marker at the end. */
export function withBotMarker(body: string) {
  return body + MARKER_SUFFIX;
}

/** Whether `body` carries the hidden bot marker. */
export function hasBotMarker(body: string) {
  return body.includes(BOT_MARKER);
}

/** `body` without the hidden bot marker. */
export function stripBotMarker(body: string) {
  return body.replaceAll(BOT_MARKER, "").trim();
}

/**
 * Whether the adapter wrote `comment`: the account the adapter posts as wrote
 * it, and it is a GitHub bot account or carries the hidden marker. Other
 * comments by that account are a person's own comments.
 *
 * @param comment - The comment to check.
 * @param postingLogin - The login the adapter posts as (`<slug>[bot]` for an App).
 */
export function isOwnComment(comment: GitHubComment, postingLogin: string) {
  const isPostingAccount =
    comment.user.login.toLowerCase() === postingLogin.toLowerCase();
  return (
    isPostingAccount &&
    (comment.user.type === "Bot" || hasBotMarker(comment.body))
  );
}
