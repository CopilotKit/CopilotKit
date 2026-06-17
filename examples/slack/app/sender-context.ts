import type { ContextEntry } from "@copilotkit/bot";
import type { PlatformUser } from "@copilotkit/bot-ui";

/**
 * Build the per-turn context naming the requesting user, so the agent can act
 * "as" them (filter Linear by their email, tag them). The adapter resolves
 * `{ id, name?, email? }` per turn; if it's absent there's nothing to attribute,
 * so we add no entry. `platform` is the surface the turn came from
 * (`thread.platform`), so the label is correct on Slack and WhatsApp alike.
 */
export function senderContext(
  user: PlatformUser | undefined,
  platform: string,
): ContextEntry[] {
  if (!user) return [];
  const label = `${user.name ?? user.id}${user.email ? ` <${user.email}>` : ""} (${platform} id ${user.id})`;
  return [{ description: `Requesting ${platform} user`, value: label }];
}
