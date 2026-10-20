import {
  defineChannelTool,
  singleStringParameterSchema,
} from "@copilotkit/channels-core";
import type { ChannelTool } from "@copilotkit/channels-core";

/**
 * Parameter schema for `lookup_discord_user`.
 *
 * Built by `singleStringParameterSchema` rather than by `z.object`, so that
 * `@copilotkit/channels-discord` declares no `zod` range. See that helper for
 * why the range was not free (PE-30). It emits the same JSON Schema document
 * the Zod object emitted, so the descriptor the model is shown is unchanged.
 */
const lookupSchema = singleStringParameterSchema({
  name: "query",
  description: "A name, display name, or handle to resolve.",
});

export const lookupDiscordUserTool: ChannelTool = defineChannelTool({
  name: "lookup_discord_user",
  description:
    "Resolve a person's name, display name, or handle to a Discord user id and a " +
    "ready-to-use <@id> mention.",
  parameters: lookupSchema,
  async handler({ query }, { thread }) {
    let user;
    try {
      user = await thread.lookupUser(query);
    } catch (error) {
      console.error(`lookup_discord_user failed for "${query}":`, error);
      return `Couldn't resolve a Discord user for "${query}" (lookup unavailable).`;
    }
    if (!user) return `No Discord user found matching "${query}".`;
    return { id: user.id, name: user.name, mention: `<@${user.id}>` };
  },
});

export const defaultDiscordTools: ChannelTool[] = [lookupDiscordUserTool];
