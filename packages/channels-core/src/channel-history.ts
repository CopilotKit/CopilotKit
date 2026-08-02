import type { ChannelTaskOperationContext } from "./tasks.js";

/** One provider message normalized for application-selected history reads. */
export interface ChannelHistoryMessage {
  id: string;
  occurredAt: string;
  actor: {
    id: string;
    kind: "human" | "bot" | "app" | "system" | "unknown";
    displayName?: string;
    handle?: string;
  };
  text: string;
  position: "root" | "reply";
}

/** One bounded chronological provider-surface page. */
export interface ChannelHistoryPage {
  messages: ChannelHistoryMessage[];
  nextCursor: string | null;
}

/** Caller-controlled paging fields; the current surface stays trusted. */
export interface ReadChannelMessagesInput {
  limit?: number;
  cursor?: string;
}

/** Adapter request after core binds the current trusted surface. */
export interface ChannelHistoryAdapterInput extends ReadChannelMessagesInput {
  surfaceId: string;
}

/** Adapter-owned provider-history client. Managed Intelligence implements it. */
export interface ChannelHistoryAdapter {
  read(
    input: ChannelHistoryAdapterInput,
    context?: ChannelTaskOperationContext,
  ): Promise<ChannelHistoryPage>;
}
