import { Routes } from "discord.js";
import type { CommandSpec } from "@copilotkit/bot";
import { truncateText } from "./render/budget.js";

// Discord caps command and option descriptions at 100 chars; a longer one
// rejects the whole command. Truncate defensively.
const DESCRIPTION_MAX = 100;

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

/**
 * Build numeric choices from an enum, skipping entries that aren't finite numbers.
 * A non-numeric enum value would serialize to `null` (NaN → null) and make Discord
 * reject the whole command batch, so drop those choices (with a warning) instead.
 */
function numericChoices(
  enumValues: unknown,
): { name: string; value: number }[] | undefined {
  if (!Array.isArray(enumValues)) return undefined;
  const choices: { name: string; value: number }[] = [];
  for (const v of enumValues) {
    const value = Number(v);
    if (Number.isFinite(value)) {
      choices.push({ name: String(v), value });
    } else {
      console.warn(
        `[bot-discord] skipping non-numeric enum choice "${String(v)}" for a numeric option.`,
      );
    }
  }
  return choices;
}

/** Map a JSON Schema (CommandSpec.options) to Discord application-command options. */
export function jsonSchemaToDiscordOptions(
  schema: Record<string, unknown> | undefined,
): DiscordOption[] {
  if (!schema) return [];
  const properties = (schema.properties as Record<string, any> | undefined) ?? {};
  const required = new Set<string>((schema.required as string[] | undefined) ?? []);
  const out: DiscordOption[] = [];

  for (const [name, prop] of Object.entries(properties)) {
    const rawDescription = typeof prop.description === "string" ? prop.description : name;
    const description = truncateText(rawDescription, DESCRIPTION_MAX);
    const base = { name, description, required: required.has(name) };
    // zod-to-json-schema can emit a nullable type as an array (e.g. ["string", "null"]).
    // Normalize to the first non-"null" member so the switch matches the real type
    // instead of falling through to the warn+string default.
    const type = Array.isArray(prop.type)
      ? (prop.type.find((x: unknown) => x !== "null") ?? prop.type[0])
      : prop.type;
    switch (type) {
      case "string": {
        const choices = Array.isArray(prop.enum)
          ? prop.enum.map((v: unknown) => ({ name: String(v), value: String(v) }))
          : undefined;
        out.push({ ...base, type: OPT_STRING, ...(choices ? { choices } : {}) });
        break;
      }
      case "integer": {
        const choices = numericChoices(prop.enum);
        out.push({ ...base, type: OPT_INTEGER, ...(choices ? { choices } : {}) });
        break;
      }
      case "number": {
        const choices = numericChoices(prop.enum);
        out.push({ ...base, type: OPT_NUMBER, ...(choices ? { choices } : {}) });
        break;
      }
      case "boolean":
        out.push({ ...base, type: OPT_BOOLEAN });
        break;
      default:
        console.warn(
          `[bot-discord] command option "${name}" has unsupported type "${String(type)}"; ` +
            "registering it as a free-text string option.",
        );
        out.push({ ...base, type: OPT_STRING });
    }
  }

  // Discord rejects a command whose optional option precedes a required one
  // ("Required options must be placed before optional options"). Stable-partition
  // so all required options come first, preserving declaration order within each group.
  return [...out.filter((o) => o.required), ...out.filter((o) => !o.required)];
}

/** The REST body for one application command. */
export function buildCommandBody(spec: CommandSpec): {
  name: string;
  description: string;
  options: DiscordOption[];
} {
  return {
    name: spec.name,
    description: truncateText(spec.description || spec.name, DESCRIPTION_MAX),
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
