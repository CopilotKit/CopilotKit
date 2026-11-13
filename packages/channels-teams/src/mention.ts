/** Minimal shape of an inbound activity that we read to detect a mention. */
export interface MentionActivityLike {
  recipient?: { id?: string };
  entities?: ReadonlyArray<{ type?: string; mentioned?: { id?: string } }>;
}

/**
 * True when the activity `@`-mentions the bot. Teams sends each mention as an
 * `entities` item of type `mention`; the bot is the activity's `recipient`.
 */
export function isRecipientMentioned(activity: MentionActivityLike): boolean {
  const botId = activity.recipient?.id;
  if (!botId) return false;
  return (activity.entities ?? []).some(
    (entity) =>
      entity.type?.toLowerCase() === "mention" &&
      entity.mentioned?.id === botId,
  );
}
