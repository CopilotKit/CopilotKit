import { z } from "zod";
import { defineChannelTool } from "@copilotkit/channels-core";
import type { ChannelTool } from "@copilotkit/channels-core";

export const lookupDiscordUserTool: ChannelTool = defineChannelTool({
  name: "lookup_discord_user",
  description:
    "Resolve a person's name, display name, or handle to a Discord user id and a " +
    "ready-to-use <@id> mention.",
  parameters: z.object({
    query: z
      .string()
      .min(1)
      .describe("A name, display name, or handle to resolve."),
  }),
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
