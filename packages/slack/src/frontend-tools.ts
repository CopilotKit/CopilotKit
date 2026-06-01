import type { WebClient } from "@slack/web-api";
import type { FrontendTool as CoreFrontendTool } from "@copilotkit/core";
import {
  type StandardSchemaV1,
  type InferSchemaOutput,
  type ObjectSchema,
  type SchemaParseResult,
  toJsonSchema,
  validateSchema,
} from "./standard-schema.js";

/**
 * A Slack frontend tool — the same `FrontendTool<T>` shape used by
 * `@copilotkit/core` and `@copilotkit/react/v2`, plus a Slack-flavoured
 * handler context that exposes the bot's `WebClient`, the active
 * `channel`/`threadTs`, and the bot's user id.
 *
 * Concretely:
 *
 *   - `name`, `description?`, `parameters?`, `followUp?`, `agentId?`,
 *     `available?` flow through from `@copilotkit/core`.
 *   - `handler(args, ctx)` is the Slack-flavoured override: `ctx`
 *     extends the canonical `FrontendToolHandlerContext` with the
 *     extras a Slack tool needs to read from / act on Slack itself
 *     (look up a user, post a Block Kit surface, react to a message,
 *     etc.).
 *
 * `Schema` is any [Standard Schema](https://standardschema.dev)
 * validator — Zod (v3.24+ or v4), Valibot, ArkType, etc. — the same
 * type `@copilotkit/core` declares for `parameters`. Authors pick the
 * validation library they like; consumers of the slack package can
 * also accept any `CoreFrontendTool<T>` without a shape mismatch
 * (modulo the ctx widening; bridge-supplied tools see the full slack
 * ctx).
 */
export type FrontendTool<Schema extends ObjectSchema = ObjectSchema> = Omit<
  CoreFrontendTool<InferSchemaOutput<Schema>>,
  "handler" | "parameters"
> & {
  parameters: Schema;
  /**
   * Tool implementation. Returns anything — the bridge stringifies
   * non-string returns via `JSON.stringify` for the tool-result
   * message it sends back to the agent. Returning a string makes the
   * raw text the tool result (skip stringification).
   */
  handler(
    args: InferSchemaOutput<Schema>,
    ctx: FrontendToolContext,
  ): Promise<unknown> | unknown;
};

/**
 * Per-call context handed to a tool's `handler`. Slack-flavoured —
 * `client`, `channel`, `threadTs`, `botUserId`, `conversationKey` are
 * the fields a Slack tool actually needs (read from / act on Slack).
 *
 * Intentionally NOT `extends FrontendToolHandlerContext` from
 * `@copilotkit/core` — core's ctx assumes per-call `toolCall` and
 * `agent` are reachable, but the Slack bridge doesn't always have
 * a usable `toolCall` shape at hand (it operates on AG-UI events
 * directly, not core's wrapped ToolCall objects). The shape parity
 * lives at the `FrontendTool` level: a Slack tool IS a core
 * `FrontendTool<T>` with `parameters` set + a Slack-flavoured
 * `handler` ctx.
 */
export interface FrontendToolContext {
  client: WebClient;
  channel: string;
  threadTs?: string;
  botUserId: string;
  /**
   * Slack user id of the person who sent the message this turn is handling
   * (the requester). Lets a tool act on their behalf — e.g. resolve "my"
   * to this user. Absent if the originating event carried no user.
   */
  senderUserId?: string;
  /**
   * Stable key identifying the conversation this turn belongs to —
   * `${channelId}::${scope}` where scope is the thread ts or
   * `DM_SCOPE`. Used by human-in-the-loop tools to register pending
   * waits that the bridge can cancel on interrupt.
   */
  conversationKey: string;
  /** Cooperative cancel signal — aborted when the bridge cancels the turn. */
  signal?: AbortSignal;
}

/** AG-UI's `Tool` shape — what we hand off via `runAgent({tools})`. */
export interface AgentToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * AG-UI context entry — `{description, value}` pairs that travel in
 * the AG-UI input alongside `tools` and get surfaced to the LLM as
 * system / developer-level guidance.
 *
 * Mirrors the React `useAgentContext` / `useCopilotReadable`
 * mechanism — same plumbing on the AG-UI side, just sourced from a
 * Slack app's config instead of a React component tree.
 */
export interface SlackContextEntry {
  description: string;
  value: string;
}

/**
 * Convert the catalog into the AG-UI tool-descriptor shape the agent
 * sees. Each tool's Standard Schema becomes JSON Schema (see
 * {@link toJsonSchema}).
 */
export function toAgentToolDescriptors(
  tools: ReadonlyArray<FrontendTool>,
): AgentToolDescriptor[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    parameters: toJsonSchema(t.parameters),
  }));
}

/**
 * Parse the raw tool-call args coming back from the agent through the
 * tool's Standard Schema. Returns `{ok: true, value}` on success,
 * `{ok: false, error}` on validation failure — the caller (turn-runner)
 * turns the error into a JSON tool result so the agent can recover.
 *
 * Async because Standard Schema validators may resolve asynchronously
 * (sync validators like Zod/Valibot resolve immediately).
 */
export function parseToolArgs<Schema extends StandardSchemaV1>(
  schema: Schema,
  rawArgs: unknown,
): Promise<SchemaParseResult<InferSchemaOutput<Schema>>> {
  return validateSchema(schema, rawArgs);
}

/**
 * Normalize a `handler` return value into the string the AG-UI
 * tool-result message expects. Strings pass through; everything else
 * gets JSON-stringified. `undefined` becomes `""` so the agent sees
 * a deterministic empty result.
 */
export function stringifyHandlerResult(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
