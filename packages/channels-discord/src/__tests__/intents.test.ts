import { describe, it, expect } from "vitest";
import { GatewayIntentBits, Partials } from "discord.js";
import {
  DISCORD_DEFAULT_INTENTS,
  DISCORD_DEFAULT_PARTIALS,
} from "../discord-connector.js";

it("requests the reaction intent and partials", () => {
  expect(DISCORD_DEFAULT_INTENTS).toContain(
    GatewayIntentBits.GuildMessageReactions,
  );
  expect(DISCORD_DEFAULT_PARTIALS).toContain(Partials.Message);
  expect(DISCORD_DEFAULT_PARTIALS).toContain(Partials.Reaction);
});
