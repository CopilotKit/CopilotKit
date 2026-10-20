import type { TextPart } from "@ag-ui/core";

export interface CopilotChatMentionItem {
  id: string;
  label: string;
  value: string;
}

export interface CopilotChatMentionMetadata {
  type: "mention";
  id: string;
  label: string;
}

export type CopilotChatMentionPart = TextPart & {
  metadata: {
    copilotkit: CopilotChatMentionMetadata;
    [key: string]: unknown;
  };
};

/** Creates the persisted AG-UI text part for a selected chat mention. */
export function createMentionPart(
  item: CopilotChatMentionItem,
): CopilotChatMentionPart {
  return {
    type: "text",
    text: `Mention: ${item.label}\n${item.value}`,
    metadata: {
      copilotkit: {
        type: "mention",
        id: item.id,
        label: item.label,
      },
    },
  };
}

/** Returns validated CopilotKit mention metadata from an AG-UI text part. */
export function getMentionMetadata(
  part: unknown,
): CopilotChatMentionMetadata | undefined {
  if (!part || typeof part !== "object") return undefined;

  const candidate = part as {
    type?: unknown;
    metadata?: { copilotkit?: unknown } | null;
  };
  if (candidate.type !== "text") return undefined;

  const metadata = candidate.metadata?.copilotkit;
  if (!metadata || typeof metadata !== "object") return undefined;

  const mention = metadata as {
    type?: unknown;
    id?: unknown;
    label?: unknown;
  };
  if (
    mention.type !== "mention" ||
    typeof mention.id !== "string" ||
    typeof mention.label !== "string"
  ) {
    return undefined;
  }

  return {
    type: "mention",
    id: mention.id,
    label: mention.label,
  };
}

/** Determines whether a message content part is a CopilotKit mention. */
export function isMentionPart(part: unknown): part is CopilotChatMentionPart {
  return getMentionMetadata(part) !== undefined;
}
