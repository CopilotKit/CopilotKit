import { z } from "zod";
import { defineBotTool } from "@copilotkit/bot";
import type { BotTool } from "@copilotkit/bot";

export const lookupDiscordUserTool: BotTool = defineBotTool({
  name: "lookup_discord_user",
  description:
    "Resolve a person's name, display name, or handle to a Discord user id and a " +
    "ready-to-use <@id> mention.",
  parameters: z.object({
    query: z.string().describe("A name, display name, or handle to resolve."),
  }),
  async handler({ query }, { thread }) {
    const user = await thread.lookupUser(query);
    if (!user) return `No Discord user found matching "${query}".`;
    return { id: user.id, name: user.name, mention: `<@${user.id}>` };
  },
});

export const defaultDiscordTools: BotTool[] = [lookupDiscordUserTool];
