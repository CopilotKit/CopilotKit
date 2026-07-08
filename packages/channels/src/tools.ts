import type { InferSchemaOutput, ObjectSchema } from "./standard-schema.js";
import { toJsonSchema, validateSchema } from "./standard-schema.js";
import type {
  Thread,
  IncomingMessage,
  PlatformUser,
} from "@copilotkit/channels-ui";

export type { ObjectSchema } from "./standard-schema.js";

export interface BotToolContext {
  thread: Thread;
  message?: IncomingMessage;
  user?: PlatformUser;
  signal?: AbortSignal;
  platform: string;
}
export type BotTool<Schema extends ObjectSchema = ObjectSchema> = {
  name: string;
  description: string;
  parameters: Schema;
  /**
   * Run the tool. The returned value is what the **agent (LLM)** reads back as
   * the tool result — not the end user.
   *
   * Return any value: a `string` is sent to the agent as-is; `null`/`undefined`
   * becomes an empty string; any other value is JSON-stringified automatically
   * (see {@link stringifyHandlerResult}). Do NOT hand-stringify and do NOT
   * return boilerplate like `{ ok: true }`.
   *
   * Return something MEANINGFUL to the model:
   * - a render tool (one that posts a card via `thread.post`) → a short
   *   natural-language confirmation (e.g. `"Displayed the issue card to the
   *   user."`) so the model gives a brief ack and doesn't restate the card;
   * - a failure → the actual error text so the model can repair and retry;
   * - a data tool → the data itself (return the raw object/array — the SDK
   *   serializes it for you).
   */
  handler(
    args: InferSchemaOutput<Schema>,
    ctx: BotToolContext,
  ): Promise<unknown> | unknown;
};

/**
 * Define a {@link BotTool} with full type inference. The handler's `args` are
 * inferred from `parameters`, and `ctx` is the generic {@link BotToolContext}
 * ({@link Thread} + optional message/user/signal + platform). Reach for
 * platform power via capability-gated `thread` methods (e.g.
 * `thread.getMessages()`, `thread.lookupUser(query)`).
 *
 * ```ts
 * const tool = defineBotTool({
 *   name: "show_thing",
 *   description: "...",
 *   parameters: z.object({ id: z.string() }),
 *   async handler({ id }, { thread }) {  // `id` and `ctx` fully typed
 *     await thread.post(<Thing id={id} />);
 *     return "Displayed the thing.";
 *   },
 * });
 * ```
 */
export function defineBotTool<Schema extends ObjectSchema>(
  tool: BotTool<Schema>,
): BotTool<Schema> {
  return tool;
}

export interface ContextEntry {
  description: string;
  value: string;
}
export interface AgentToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export function toAgentToolDescriptors(
  tools: ReadonlyArray<BotTool>,
): AgentToolDescriptor[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: toJsonSchema(t.parameters),
  }));
}
export const parseToolArgs = validateSchema;
export function stringifyHandlerResult(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
