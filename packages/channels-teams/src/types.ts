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

/**
 * Teams adapter config — CREDENTIAL-FREE. The adapter builds nothing from
 * `clientId`/`clientSecret`/`tenantId`; those now live only on
 * {@link CloudAdapterTeamsConnectorOptions} (see `teams-connector.ts`) — a
 * runner constructs that connector and injects it via
 * `TeamsAdapter.ɵbindConnector` before `start()`/any egress call. Running the
 * adapter unbound throws (see the `connector` getter on `TeamsAdapter`) —
 * that's the intended "you need a custom ChannelRunner" signpost for running
 * Channels without CopilotKit Intelligence.
 */
export interface TeamsAdapterOptions {
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
