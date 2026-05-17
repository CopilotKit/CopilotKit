import type { WebClient } from "@slack/web-api";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * What a Slack "frontend tool" looks like — the same concept AG-UI uses
 * for web frontends, except the actor here is the Slack bridge: a tool
 * the agent can call to read from / act on Slack itself (look up a user,
 * react with an emoji, post a Block Kit surface, etc.).
 *
 * Tools declare their args as a Zod schema. The SDK:
 *   - converts it to JSON Schema for `runAgent({tools})` so the LLM sees
 *     a structured signature,
 *   - parses the raw tool-call args through the schema at call time so
 *     `execute` receives correctly-typed values (or a validation error
 *     bubbles back to the agent as the tool result).
 */
export interface FrontendTool<Schema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: Schema;
  execute(args: z.infer<Schema>, ctx: FrontendToolContext): Promise<string>;
}

/**
 * Per-call context handed to a tool's `execute`. Currently this is the
 * Slack client plus the reply target (so a tool can post a status, react
 * to a message, etc. if it wants to). More fields will land here as more
 * tools need them.
 */
export interface FrontendToolContext {
  client: WebClient;
  channel: string;
  threadTs?: string;
  botUserId: string;
  /**
   * Stable key identifying the conversation this turn belongs to —
   * `${channelId}::${scope}` where scope is the thread ts or `DM_SCOPE`.
   * Used by human-in-the-loop tools to register pending waits that the
   * bridge can cancel on interrupt.
   */
  conversationKey: string;
}

/** AG-UI's `Tool` shape — what we hand off via `runAgent({tools})`. */
export interface AgentToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * AG-UI context entry — `{description, value}` pairs that travel in the
 * AG-UI input alongside `tools` and get surfaced to the LLM as system /
 * developer-level guidance. This is how user-land tells the agent
 * "things to know about the Slack environment you're running in":
 * how mentions work, what frontend tools exist, mrkdwn vs markdown
 * formatting, etc.
 *
 * Mirrors the React `useAgentContext` / `useCopilotReadable` mechanism
 * — same plumbing on the AG-UI side, just sourced from a Slack app's
 * config instead of a React component tree.
 */
export interface SlackContextEntry {
  description: string;
  value: string;
}

/**
 * Convert the catalog into the AG-UI tool-descriptor shape the agent
 * sees. Zod schemas become JSON Schema; everything else passes through.
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
      description: t.description,
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
