import { DM_SCOPE } from "./types.js";
import type { ConversationKey, ReplyTarget } from "./types.js";

export interface ListenerHandlers {
  onTurn(turn: {
    conversation: ConversationKey;
    replyTarget: ReplyTarget;
    userText: string;
    senderUserId?: string;
    senderName?: string;
  }): Promise<void>;
  onCommand(cmd: {
    command: string;
    text: string;
    conversation: ConversationKey;
    replyTarget: ReplyTarget;
    senderUserId?: string;
    senderName?: string;
  }): Promise<void>;
  onThreadStarted(evt: {
    conversation: ConversationKey;
    replyTarget: ReplyTarget;
    senderUserId?: string;
  }): Promise<void>;
}

/**
 * Route a raw Google Chat webhook event to the appropriate handler.
 *
 * Routing rules:
 *   - MESSAGE with slashCommand → onCommand
 *   - MESSAGE (plain, non-bot sender) → onTurn
 *   - MESSAGE from the bot itself → skipped (loop guard)
 *   - ADDED_TO_SPACE → onThreadStarted
 *   - CARD_CLICKED and anything else → ignored (handled elsewhere)
 */
export async function routeChatEvent(
  event: unknown,
  ctx: { botUserId: string; handlers: ListenerHandlers },
): Promise<void> {
  const raw = event as {
    type?: string;
    space?: { name?: string; type?: string };
    message?: {
      text?: string;
      argumentText?: string;
      thread?: { name?: string };
      sender?: { name?: string; displayName?: string; type?: string };
      slashCommand?: { commandName?: string };
      annotations?: Array<{
        type?: string;
        slashCommand?: { commandName?: string };
      }>;
    };
    user?: { name?: string; displayName?: string };
  };

  const { botUserId, handlers } = ctx;
  const spaceId = raw.space?.name;
  const isDm = raw.space?.type === "DM";

  if (raw.type === "MESSAGE") {
    const msg = raw.message;
    if (!msg) return;

    // Loop guard: skip the bot's own messages.
    if (msg.sender?.type === "BOT" || msg.sender?.name === botUserId) return;

    if (!spaceId) return;

    const senderUserId = msg.sender?.name;
    const senderName = msg.sender?.displayName;

    // Determine scope and replyTarget.
    const threadName = msg.thread?.name;
    const scope = isDm ? DM_SCOPE : (threadName ?? "");
    const conversation: ConversationKey = { spaceId, scope };
    const replyTarget: ReplyTarget = {
      space: spaceId,
      thread: isDm ? undefined : threadName,
      senderName,
    };

    // Check for slash command (via slashCommand field OR annotations).
    const slashCmd =
      msg.slashCommand ??
      msg.annotations?.find((a) => a.type === "SLASH_COMMAND")?.slashCommand;

    if (slashCmd) {
      const command = slashCmd.commandName ?? "";
      const text = (msg.argumentText ?? "").trim();
      await handlers.onCommand({
        command,
        text,
        conversation,
        replyTarget,
        senderUserId,
        senderName,
      });
      return;
    }

    // Plain message → onTurn.
    // Chat's argumentText already strips the bot mention; prefer it over text.
    const rawText = msg.argumentText ?? msg.text ?? "";
    const userText = rawText.trim();

    await handlers.onTurn({
      conversation,
      replyTarget,
      userText,
      senderUserId,
      senderName,
    });
    return;
  }

  if (raw.type === "ADDED_TO_SPACE") {
    if (!spaceId) return;
    const scope = isDm ? DM_SCOPE : "";
    const conversation: ConversationKey = { spaceId, scope };
    const replyTarget: ReplyTarget = { space: spaceId };
    const senderUserId = raw.user?.name;
    await handlers.onThreadStarted({ conversation, replyTarget, senderUserId });
    return;
  }

  // CARD_CLICKED and all other event types are ignored here.
}
