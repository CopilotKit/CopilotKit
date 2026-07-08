import type { InferSchemaOutput, ObjectSchema } from "./standard-schema.js";
import { toJsonSchema } from "./standard-schema.js";
import type { Thread, PlatformUser, ModalView } from "@copilotkit/channels-ui";

/**
 * Context handed to a slash-command handler. `text` is the raw argument string
 * (the form Slack delivers); `options` is the parsed, typed form, populated by
 * surfaces that deliver structured args natively (e.g. Discord). On text-only
 * surfaces `options` is empty — read `text` there.
 */
export interface CommandContext<TOptions = Record<string, never>> {
  /** The conversation the command was invoked in. */
  thread: Thread;
  /** The invoked command name, normalized (no leading slash, lower-cased). */
  command: string;
  /** Raw argument string after the command name. */
  text: string;
  /** Parsed, typed options (empty on surfaces that only deliver `text`). */
  options: TOptions;
  /** The invoking user, when the surface provides it. */
  user?: PlatformUser;
  platform: string;
  /** Open a modal in response to this command (requires the surface's trigger; `undefined` when unavailable). */
  openModal?(view: ModalView): Promise<{ ok: boolean; error?: string }>;
}

/**
 * A slash command. Defined like a {@link import("./tools.js").BotTool}: a name,
 * an optional Standard Schema for typed options, and a handler. The `options`
 * schema maps natively to surfaces with structured args (Discord) and is used
 * to register/validate there; on text-only surfaces (Slack) args arrive via
 * `ctx.text`.
 */
export interface BotCommand<Schema extends ObjectSchema = ObjectSchema> {
  /** Command name without the leading slash (e.g. `"triage"`). Matched case-insensitively. */
  name: string;
  /** Human description — help text, and the registration label on surfaces like Discord. */
  description?: string;
  /** Optional Standard Schema for typed options. */
  options?: Schema;
  handler(ctx: CommandContext<InferSchemaOutput<Schema>>): void | Promise<void>;
}

/**
 * Define a {@link BotCommand} with full type inference: `ctx.options` is
 * inferred from `options`.
 *
 * ```ts
 * const triage = defineBotCommand({
 *   name: "triage",
 *   description: "Summarize and file the current thread.",
 *   options: z.object({ priority: z.enum(["low", "high"]).optional() }),
 *   async handler({ thread, text, options }) {
 *     await thread.runAgent({ prompt: `Triage: ${text}`, });
 *   },
 * });
 * ```
 */
export function defineBotCommand<Schema extends ObjectSchema>(
  command: BotCommand<Schema>,
): BotCommand<Schema> {
  return command;
}

/**
 * Platform-neutral descriptor an adapter may use to register a command with the
 * surface (e.g. Discord's application-command API). Produced from a
 * {@link BotCommand} by {@link toCommandSpec}.
 */
export interface CommandSpec {
  name: string;
  description: string;
  /** JSON Schema for the options, or `undefined` for a free-text command. */
  options?: Record<string, unknown>;
}

/** Normalize a command name for matching: drop a leading slash, lower-case, trim. */
export function normalizeCommandName(name: string): string {
  // Collapse "-"→"_" so a command routes the same whether invoked as
  // /file-issue (Slack/Discord allow hyphens) or /file_issue (Telegram forbids
  // them; its adapter converts on registration). This is the ROUTING key only —
  // per-adapter display names are decided in each adapter / `toCommandSpec`.
  return name.trim().replace(/^\//, "").toLowerCase().replace(/-/g, "_");
}

export function toCommandSpec(command: BotCommand): CommandSpec {
  return {
    // Preserve hyphens here (display/registration name): Discord and Slack
    // accept them, so `/file-issue` stays `/file-issue` there. Telegram's
    // adapter converts hyphens to underscores itself; routing still matches
    // because `normalizeCommandName` collapses both forms.
    name: command.name.trim().replace(/^\//, "").toLowerCase(),
    description: command.description ?? "",
    options: command.options ? toJsonSchema(command.options) : undefined,
  };
}
