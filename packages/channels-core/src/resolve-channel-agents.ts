import type { AbstractAgent } from "@ag-ui/client";
import {
  ChannelDuplicateDefaultError,
  ChannelInvalidAgentIdError,
} from "./channel-agent-errors.js";

export type ChannelAgentSource =
  | AbstractAgent
  | ((threadId: string) => AbstractAgent);

/**
 * Lookup ids a Channel accepts on `runAgent({ agentId })`.
 * `"default"` is present when `agent` or `agents.default` exists, or when
 * neither `agent` nor `agents` is passed (legacy single-agent shape).
 */
export type ChannelAgentIds<
  TAgents extends Record<string, ChannelAgentSource> | undefined,
  THasSingularAgent extends boolean,
> =
  | (THasSingularAgent extends true
      ? "default"
      : TAgents extends { default: ChannelAgentSource }
        ? "default"
        : TAgents extends Record<string, ChannelAgentSource>
          ? never
          : "default")
  | (TAgents extends Record<string, ChannelAgentSource>
      ? Exclude<Extract<keyof TAgents, string>, "default">
      : never);

/** `agentId` is required when the Channel has extras only (no default). */
export type ChannelRunAgentIdField<TAgentId extends string> =
  "default" extends TAgentId ? { agentId?: TAgentId } : { agentId: TAgentId };

/**
 * Agent ids must be non-empty, have no surrounding space, and must not
 * contain `:` (this also rejects `::`).
 */
function assertValidAgentId(id: string): void {
  if (id.length > 0 && id === id.trim() && !id.includes(":")) return;
  throw new ChannelInvalidAgentIdError(id);
}

/**
 * Parse `agent` / `agents` into a source map. Isolation happens later.
 */
export function resolveChannelAgents(opts: {
  agent?: ChannelAgentSource;
  agents?: Record<string, ChannelAgentSource>;
}): {
  defaultId: "default" | undefined;
  sources: Map<string, ChannelAgentSource>;
} {
  if (opts.agent !== undefined && opts.agents?.default !== undefined) {
    throw new ChannelDuplicateDefaultError();
  }

  const sources = new Map<string, ChannelAgentSource>();

  if (opts.agent !== undefined) {
    sources.set("default", opts.agent);
  }

  for (const [id, source] of Object.entries(opts.agents ?? {})) {
    assertValidAgentId(id);
    sources.set(id, source);
  }

  return {
    defaultId: sources.has("default") ? "default" : undefined,
    sources,
  };
}

export function checkpointThreadId(
  conversationThreadId: string,
  agentId: string,
): string {
  return agentId === "default"
    ? conversationThreadId
    : `${conversationThreadId}::${agentId}`;
}

export function canonicalAgentId(
  channelName: string | undefined,
  agentId: string,
): string | undefined {
  if (agentId === "default") return channelName;
  if (!channelName) return agentId;
  return `${channelName}:${agentId}`;
}
