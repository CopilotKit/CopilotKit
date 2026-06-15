import { Routes } from "discord.js";
import type { CommandSpec } from "@copilotkit/bot";

/** A REST client subset (discord.js REST exposes `put`). */
export interface RestLike {
  put(route: `/${string}`, options: { body: unknown }): Promise<unknown>;
}

interface DiscordOption {
  name: string;
  description: string;
  type: number; // ApplicationCommandOptionType
  required: boolean;
  choices?: { name: string; value: string | number }[];
}

// ApplicationCommandOptionType values (Discord API).
const OPT_STRING = 3;
const OPT_INTEGER = 4;
const OPT_BOOLEAN = 5;
const OPT_NUMBER = 10;

/** Map a JSON Schema (CommandSpec.options) to Discord application-command options. */
export function jsonSchemaToDiscordOptions(
  schema: Record<string, unknown> | undefined,
): DiscordOption[] {
  if (!schema) return [];
  const properties = (schema.properties as Record<string, any> | undefined) ?? {};
  const required = new Set<string>((schema.required as string[] | undefined) ?? []);
  const out: DiscordOption[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const description = typeof prop.description === "string" ? prop.description : name;
    const base = { name, description, required: required.has(name) };
    switch (prop.type) {
      case "string": {
        const choices = Array.isArray(prop.enum)
          ? prop.enum.map((v: unknown) => ({ name: String(v), value: String(v) }))
          : undefined;
        out.push({ ...base, type: OPT_STRING, ...(choices ? { choices } : {}) });
        break;
      }
      case "integer":
        out.push({ ...base, type: OPT_INTEGER });
        break;
      case "number":
        out.push({ ...base, type: OPT_NUMBER });
        break;
      case "boolean":
        out.push({ ...base, type: OPT_BOOLEAN });
        break;
      default:
        console.warn(
          `[bot-discord] command option "${name}" has unsupported type "${prop.type}"; ` +
            "registering it as a free-text string option.",
        );
        out.push({ ...base, type: OPT_STRING });
    }
  }
  return out;
}

/** The REST body for one application command. */
export function buildCommandBody(spec: CommandSpec): {
  name: string;
  description: string;
  options: DiscordOption[];
} {
  return {
    name: spec.name,
    description: spec.description || spec.name,
    options: jsonSchemaToDiscordOptions(spec.options),
  };
}

/** Publish the bot's commands: guild-scoped when guildId is set (instant), else global. */
export async function registerCommands(
  rest: RestLike,
  appId: string,
  guildId: string | undefined,
  specs: readonly CommandSpec[],
): Promise<void> {
  const body = specs.map(buildCommandBody);
  const route = guildId
    ? (Routes.applicationGuildCommands(appId, guildId) as `/${string}`)
    : (Routes.applicationCommands(appId) as `/${string}`);
  await rest.put(route, { body });
}
