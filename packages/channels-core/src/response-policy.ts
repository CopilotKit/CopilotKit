import type { ChannelConversationKind } from "./channel-agent.js";

/**
 * Product-driven response policy for an inbound message turn (plan §2). Pure and
 * side-effect-free — decides, from the normalized routing signals, whether a
 * message turn is IGNORED, handed to a matching custom handler, or auto-runs the
 * selected agent. Applied during the Channel preflight before any agent runs.
 *
 * Rules (final, from §2):
 * - DMs and assistant-pane messages are already directly addressed.
 * - A shared channel/thread message is addressed only when explicitly
 *   mentioned/tagged; a prior bot reply does NOT remove that requirement.
 * - A matching `onMention` handler takes precedence over `onMessage`, and any
 *   matching handler suppresses automatic agent execution.
 * - With no matching custom handler, an addressed message auto-runs the selected
 *   agent.
 * - An untagged shared message is ignored UNLESS an `onMessage` handler opts in
 *   (`onMention` never fires for an untagged message).
 */

/** What the Channel does with an inbound message turn. */
export type ChannelResponseDecision =
  | { readonly action: "ignore" }
  | { readonly action: "handler"; readonly handler: "mention" | "message" }
  | { readonly action: "auto_run" };

/** Normalized signals the response policy decides from. */
export interface ChannelResponseInput {
  readonly conversationKind: ChannelConversationKind;
  /** True when the bot was explicitly tagged/mentioned in the message. */
  readonly mentioned: boolean;
  /** Whether the Channel registered any `onMention` handler. */
  readonly hasMentionHandler: boolean;
  /** Whether the Channel registered any `onMessage` handler. */
  readonly hasMessageHandler: boolean;
}

/** Whether a conversation surface is directly addressed without a tag. */
function isDirectlyAddressed(kind: ChannelConversationKind): boolean {
  return kind === "direct_message" || kind === "assistant";
}

export function decideChannelResponse(
  input: ChannelResponseInput,
): ChannelResponseDecision {
  const addressed =
    isDirectlyAddressed(input.conversationKind) || input.mentioned;

  if (addressed) {
    // A matching handler suppresses auto-run; onMention wins over onMessage.
    if (input.hasMentionHandler) {
      return { action: "handler", handler: "mention" };
    }
    if (input.hasMessageHandler) {
      return { action: "handler", handler: "message" };
    }
    return { action: "auto_run" };
  }

  // Untagged shared message: only an onMessage handler opts in; onMention never
  // fires here. No handler → ignored.
  if (input.hasMessageHandler) {
    return { action: "handler", handler: "message" };
  }
  return { action: "ignore" };
}
