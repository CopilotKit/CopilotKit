import { Routes } from "discord.js";
import type { CommandSpec } from "@copilotkit/channels";
import { truncateText } from "./render/budget.js";

// Discord caps command and option descriptions at 100 chars; a longer one
// rejects the whole command. Truncate defensively.
const DESCRIPTION_MAX = 100;
// Discord caps choice name and string-choice value at 100 chars.
const CHOICE_NAME_MAX = 100;
const CHOICE_VALUE_MAX = 100;
// Discord caps choices-per-option and options-per-command at 25.
const CHOICES_MAX = 25;
const OPTIONS_MAX = 25;
// Discord chat-input command/option names must match ^[-_\p{L}\p{N}]{1,32}$ and be lowercase.
const NAME_MAX = 32;

/**
 * Normalize a command/option name to satisfy Discord's chat-input naming rule
 * (`^[-_\p{L}\p{N}]{1,32}$`, lowercase). Lowercase, replace any disallowed char
 * with "_", collapse repeated underscores, truncate to 32, and fall back to a
 * sensible default if the result is empty. A malformed name would otherwise
 * reject the whole registration batch.
 */
function normalizeName(name: string, fallback: string): string {
  let slug: string;
  try {
    // Unicode-aware: keep letters/numbers from any script, plus "-" and "_".
    slug = name.toLowerCase().replace(/[^-_\p{L}\p{N}]/gu, "_");
  } catch {
    // Pragmatic fallback if \p{L}/\p{N} are unsupported in the target runtime.
    slug = name.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  }
  slug = slug.replace(/_+/g, "_").slice(0, NAME_MAX);
  return slug.length > 0 ? slug : fallback;
}

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
 * Build numeric choices from an enum, skipping entries that don't satisfy `keep`
 * (integers vs any finite number) and entries whose name is empty/whitespace.
 * A non-numeric enum value would serialize to `null` (NaN → null) and make Discord
 * reject the whole command batch, so drop those choices (with a warning) instead.
 * Returns `undefined` (not `[]`) when zero choices survive, since Discord rejects
 * an empty `choices` array.
 */
function numericChoices(
  enumValues: unknown,
  keep: (value: number) => boolean,
): { name: string; value: number }[] | undefined {
  if (!Array.isArray(enumValues)) return undefined;
  const choices: { name: string; value: number }[] = [];
  for (const v of enumValues) {
    const name = String(v);
    if (name.trim().length === 0) {
      console.warn(
        `[bot-discord] skipping enum choice with empty name for a numeric option.`,
      );
      continue;
    }
    const value = Number(v);
    if (keep(value)) {
      choices.push({ name: truncateText(name, CHOICE_NAME_MAX), value });
    } else {
      console.warn(
        `[bot-discord] skipping non-numeric enum choice "${name}" for a numeric option.`,
      );
    }
  }
  if (choices.length === 0) return undefined;
  return clampChoices(choices);
}

/** Clamp a choices array to Discord's 25-choice cap, warning (not silently dropping) on overflow. */
function clampChoices<T>(choices: T[]): T[] {
  if (choices.length <= CHOICES_MAX) return choices;
  console.warn(
    `[bot-discord] option has ${choices.length} choices; clamping to Discord's max of ${CHOICES_MAX}.`,
  );
  return choices.slice(0, CHOICES_MAX);
}

/** Map a JSON Schema (CommandSpec.options) to Discord application-command options. */
export function jsonSchemaToDiscordOptions(
  schema: Record<string, unknown> | undefined,
): DiscordOption[] {
  if (!schema) return [];
  const properties =
    (schema.properties as Record<string, any> | undefined) ?? {};
  const required = new Set<string>(
    (schema.required as string[] | undefined) ?? [],
  );
  const out: DiscordOption[] = [];

  for (const [rawName, prop] of Object.entries(properties)) {
    const name = normalizeName(rawName, "option");
    const rawDescription =
      typeof prop.description === "string" ? prop.description : rawName;
    const description = truncateText(rawDescription, DESCRIPTION_MAX);
    const base = { name, description, required: required.has(rawName) };
    // zod-to-json-schema can emit a nullable type as an array (e.g. ["string", "null"]).
    // Normalize to the first non-"null" member so the switch matches the real type
    // instead of falling through to the warn+string default.
    const type = Array.isArray(prop.type)
      ? (prop.type.find((x: unknown) => x !== "null") ?? prop.type[0])
      : prop.type;
    switch (type) {
      case "string": {
        const choices = stringChoices(prop.enum);
        out.push({
          ...base,
          type: OPT_STRING,
          ...(choices ? { choices } : {}),
        });
        break;
      }
      case "integer": {
        const choices = numericChoices(prop.enum, (v) => Number.isInteger(v));
        out.push({
          ...base,
          type: OPT_INTEGER,
          ...(choices ? { choices } : {}),
        });
        break;
      }
      case "number": {
        const choices = numericChoices(prop.enum, (v) => Number.isFinite(v));
        out.push({
          ...base,
          type: OPT_NUMBER,
          ...(choices ? { choices } : {}),
        });
        break;
      }
      case "boolean":
        out.push({ ...base, type: OPT_BOOLEAN });
        break;
      default:
        console.warn(
          `[bot-discord] command option "${rawName}" has unsupported type "${String(type)}"; ` +
            "registering it as a free-text string option.",
        );
        out.push({ ...base, type: OPT_STRING });
    }
  }

  // Discord rejects a command whose optional option precedes a required one
  // ("Required options must be placed before optional options"). Stable-partition
  // so all required options come first, preserving declaration order within each group.
  const ordered = [
    ...out.filter((o) => o.required),
    ...out.filter((o) => !o.required),
  ];
  // Discord caps a command at 25 options. Clamp (don't silently drop) on overflow.
  if (ordered.length > OPTIONS_MAX) {
    console.warn(
      `[bot-discord] command has ${ordered.length} options; clamping to Discord's max of ${OPTIONS_MAX}.`,
    );
    return ordered.slice(0, OPTIONS_MAX);
  }
  return ordered;
}

/**
 * Build string choices from an enum: skip empty/whitespace names, and clamp the
 * array to 25. The choice `value` is what Discord sends back on selection and is
 * validated against the original enum, so it must round-trip exactly — never
 * truncate it. Instead, SKIP (with a warning) any choice whose value exceeds the
 * 100-char cap, since a truncated value would fail enum validation. The `name` is
 * display-only and may still be truncated to 100. Returns `undefined` when zero
 * choices survive, since Discord rejects an empty `choices` array.
 */
function stringChoices(
  enumValues: unknown,
): { name: string; value: string }[] | undefined {
  if (!Array.isArray(enumValues)) return undefined;
  const choices: { name: string; value: string }[] = [];
  for (const v of enumValues) {
    const value = String(v);
    if (value.trim().length === 0) {
      console.warn(
        `[bot-discord] skipping enum choice with empty name for a string option.`,
      );
      continue;
    }
    if (value.length > CHOICE_VALUE_MAX) {
      console.warn(
        `[bot-discord] skipping string enum choice whose value exceeds ${CHOICE_VALUE_MAX} chars; ` +
          "a truncated value would no longer match the enum on selection.",
      );
      continue;
    }
    choices.push({
      name: truncateText(value, CHOICE_NAME_MAX),
      value,
    });
  }
  if (choices.length === 0) return undefined;
  return clampChoices(choices);
}

/** The REST body for one application command. */
export function buildCommandBody(spec: CommandSpec): {
  name: string;
  description: string;
  options: DiscordOption[];
} {
  return {
    name: normalizeName(spec.name, "command"),
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
