import type { TurnContext } from "@microsoft/agents-hosting";
import type { ConversationReference } from "@microsoft/agents-activity";
import type { FileDeliveryConfig } from "./download-files.js";

/**
 * Stable per-conversation key. Teams gives every conversation (1:1 chat, group
 * chat, or channel) a durable `conversation.id`, which is exactly the grain we
 * want: one agent session per conversation.
 */
export type ConversationKey = string;

/**
 * Where a reply goes.
 *
 * Replies sent *inside* the originating turn use the live {@link TurnContext}
 * (the simplest path, and the one the M365 Agents Playground exercises). The
 * {@link ConversationReference} is captured alongside it so the same target can
 * later drive proactive (out-of-turn) sends via
 * `CloudAdapter.continueConversation`.
 */
export interface TeamsReplyTarget {
  conversationKey: ConversationKey;
  reference: Partial<ConversationReference>;
  /** Live turn context, present while replying within the originating activity. */
  context?: TurnContext;
}

export interface TeamsAdapterOptions {
  /**
   * Port for the bot's `POST /api/messages` endpoint. Defaults to `3978`, the
   * endpoint the M365 Agents Playground connects to.
   */
  port?: number;
  /**
   * Microsoft app (client) id. Omit for anonymous local development with the
   * M365 Agents Playground; required to talk to real Teams via Azure Bot
   * Service. Falls back to the `clientId` env var.
   */
  clientId?: string;
  /** Microsoft client secret. Omit for anonymous local dev. Falls back to `clientSecret`. */
  clientSecret?: string;
  /** Microsoft tenant (directory) id. Omit for multi-tenant / anonymous. Falls back to `tenantId`. */
  tenantId?: string;
  /**
   * Custom-event names treated as interrupts by the run renderer (captured for
   * an `onInterrupt` handler). Defaults to `on_interrupt`, the name
   * LangGraph's AG-UI adapter emits.
   */
  interruptEventNames?: ReadonlySet<string>;
  /**
   * Tunables for inbound file handling (size/count caps applied when a user
   * uploads files). Defaults are sane; override only to widen or tighten them.
   */
  files?: FileDeliveryConfig;
}
