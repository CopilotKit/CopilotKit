import type { Token, Tokens, TokensList } from "marked";

/**
 * A single parsed markdown node. This is `marked`'s token union, re-exported as
 * the stable public contract that framework renderers switch on. Consumers
 * should treat `type` as the discriminant (e.g. "heading", "paragraph", "code",
 * "list", "table", "strong", "em", "link", "image", ...).
 */
// Intentional pass-through: this is marked's Token union today. If CopilotKit
// ever needs to diverge from marked, replace this with an explicit
// discriminated union and update all framework renderers.
export type MarkdownToken = Token;

/** The ordered list of top-level tokens returned by parseMarkdown. */
export type MarkdownTokenList = TokensList;

export type { Tokens };
