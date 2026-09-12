import { randomId } from "@copilotkit/shared";

/**
 * Resolve the id to use for a streamed TextMessageOutput.
 *
 * Upstream events occasionally arrive with `messageId` missing, null, or an
 * empty string. We fall back to a freshly generated id in those cases so the
 * resulting output never surfaces a null id to the GraphQL client (#2118).
 */
export function resolveMessageId(
  eventMessageId: string | null | undefined,
): string {
  return eventMessageId || randomId();
}
