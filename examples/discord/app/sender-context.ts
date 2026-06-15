import type { ContextEntry } from "@copilotkit/bot";
import type { PlatformUser } from "@copilotkit/bot-ui";

/**
 * Build the per-turn context naming the requesting Discord user, so the agent
 * can act "as" them (filter Linear by their email, @-mention them). The Discord
 * adapter resolves `{ id, name?, email? }` per turn; if it's absent there's
 * nothing to attribute, so we add no entry.
 */
export function senderContext(user: PlatformUser | undefined): ContextEntry[] {
  if (!user) return [];
  const label = `${user.name ?? user.id}${user.email ? ` <${user.email}>` : ""} (Discord id ${user.id})`;
  return [{ description: "Requesting Discord user", value: label }];
}
