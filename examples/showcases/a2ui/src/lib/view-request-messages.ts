import { VIEW_CATALOG } from "./view-catalog";

export const REQUESTED_VIEW_METADATA_KEY = "research-desk:requested-view";

interface MessageLike {
  id: string;
  role: string;
  metadata?: Record<string, unknown>;
}

export function requestedView(message: Pick<MessageLike, "metadata">) {
  return VIEW_CATALOG.find(
    (view) => view.id === message.metadata?.[REQUESTED_VIEW_METADATA_KEY],
  );
}

interface ViewSubmission {
  threadId: string;
  viewId: string | null;
  existingIds: Set<string>;
}

/** Pairs explicit submit-time choices with SDK-created message IDs. */
export class ViewRequestSubmissions {
  private pending: ViewSubmission[] = [];

  begin(
    threadId: string,
    viewId: string | null,
    messages: readonly { id: string }[],
  ) {
    const submission = {
      threadId,
      viewId,
      existingIds: new Set(messages.map((message) => message.id)),
    };
    this.pending.push(submission);
    return submission;
  }

  finish(submission: ViewSubmission) {
    this.pending = this.pending.filter((item) => item !== submission);
  }

  clear() {
    this.pending = [];
  }

  annotate<T extends MessageLike>(
    messages: readonly T[],
    threadId: string,
  ): T[] | undefined {
    const submission = this.pending.find((item) => item.threadId === threadId);
    if (!submission) return;
    const message = messages.filter((item) => item.role === "user").at(-1);
    // Restoring history or continuing a tool run adds no submitted user turn.
    if (!message || submission.existingIds.has(message.id)) return;
    this.finish(submission);
    // Queued submissions can share an initial history. This question is now
    // history for all of them, including any intervening tool continuation.
    for (const pending of this.pending) {
      if (pending.threadId === threadId) pending.existingIds.add(message.id);
    }
    if (!submission.viewId) return;
    return messages.map((item) =>
      item.id === message.id
        ? {
            ...item,
            metadata: {
              ...item.metadata,
              [REQUESTED_VIEW_METADATA_KEY]: submission.viewId,
            },
          }
        : item,
    );
  }
}
