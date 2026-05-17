import type { WebClient } from "@slack/web-api";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { FrontendTool as CoreFrontendTool } from "@copilotkit/core";

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
 * `Schema` here is a Zod schema (which already implements
 * `StandardSchemaV1`, the type core declares for `parameters`), so
 * authors write tools the way they always have — but consumers of
 * the slack package can also accept any `CoreFrontendTool<T>` without
 * a shape mismatch (modulo the ctx widening; bridge-supplied tools
 * see the full slack ctx).
 */
export type FrontendTool<Schema extends z.ZodType = z.ZodType> = Omit<
  CoreFrontendTool<z.infer<Schema>>,
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
    args: z.infer<Schema>,
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
 * sees. Zod schemas become JSON Schema; everything else passes
 * through.
 */
export function toAgentToolDescriptors(
  tools: ReadonlyArray<FrontendTool>,
): AgentToolDescriptor[] {
  return tools.map((t) => {
    const jsonSchema = zodToJsonSchema(t.parameters, {
      // Inline everything — most LLM tool-call APIs reject `$ref`-style
      // composite schemas. The slight bloat is fine for our handful of
      // tools.
      $refStrategy: "none",
      target: "jsonSchema7",
    }) as Record<string, unknown>;
    return {
      name: t.name,
      description: t.description ?? "",
      parameters: jsonSchema,
    };
  });
}

/**
 * Parse the raw tool-call args coming back from the agent through the
 * tool's schema. Returns `{ok: true, value}` on success, `{ok: false,
 * error}` on validation failure — the caller (turn-runner) turns the
 * error into a JSON tool result so the agent can recover.
 */
export function parseToolArgs<Schema extends z.ZodType>(
  schema: Schema,
  rawArgs: unknown,
): { ok: true; value: z.infer<Schema> } | { ok: false; error: string } {
  const result = schema.safeParse(rawArgs);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; "),
  };
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
