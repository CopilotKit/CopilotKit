import type { ContextEntry } from "@copilotkit/bot";
import type { PlatformUser } from "@copilotkit/bot-ui";

/**
 * Build the per-turn context naming the requesting user, so the agent can act
 * "as" them and attribute the tag. The platform adapter resolves
 * `{ id, name?, email? }` per turn; if it's absent there's nothing to
 * attribute, so we add no entry. `platform` is the surface the turn came from
 * (`thread.platform`, `"slack"` here) — kept generic so the same helper works
 * unchanged if you swap in another adapter.
 */
export function senderContext(
  user: PlatformUser | undefined,
  platform: string,
): ContextEntry[] {
  // `createBot` substitutes `{ id: "" }` for an unresolved sender (a truthy
  // object), so guard on a usable id — not mere object presence.
  if (!user?.id) return [];
  const label = `${user.name ?? user.id}${user.email ? ` <${user.email}>` : ""} (${platform} id ${user.id})`;
  return [{ description: `Requesting ${platform} user`, value: label }];
}
