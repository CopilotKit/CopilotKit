import type { ContextEntry } from "@copilotkit/channels";
import type { ApplicationUser } from "@copilotkit/channels";

/**
 * Build the per-turn context naming the requesting user, so the agent can act
 * "as" them. `createChannel` resolves the provider actor to this canonical
 * application user once per turn. If no application user maps, there is
 * nothing to attribute, so we add no entry.
 */
export function senderContext(
  user: ApplicationUser | null,
  platform: string,
): ContextEntry[] {
  if (!user?.id) return [];
  const label = `${user.name} (application user ${user.id})`;
  return [{ description: `Requesting ${platform} user`, value: label }];
}
