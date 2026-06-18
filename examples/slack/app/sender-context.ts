import type { ContextEntry } from "@copilotkit/bot";
import type { PlatformUser } from "@copilotkit/bot-ui";

/**
 * Build the per-turn context naming the requesting Slack user, so the agent
 * can act "as" them (filter Linear by their email, @-mention them). The Slack
 * adapter resolves `{ id, name?, email? }` per turn; if it's absent there's
 * nothing to attribute, so we add no entry.
 */
export function senderContext(user: PlatformUser | undefined): ContextEntry[] {
  if (!user) return [];
  const label = `${user.name ?? user.id}${user.email ? ` <${user.email}>` : ""} (Slack id ${user.id})`;
  return [{ description: "Requesting Slack user", value: label }];
}
