import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InMemorySessionStore } from "@ag-ui/claude-managed-agents";
import { z } from "zod";

const resource = z.object({ id: z.string() });
const lockSchema = z.object({ resources: z.record(resource) });

/** Resolve exact Ant resource paths, with server-side overrides for deployment. */
export function requireStack(): { agentId: string; environmentId: string } {
  let resources: Record<string, { id: string }> = {};
  try {
    resources = lockSchema.parse(
      JSON.parse(readFileSync(join(process.cwd(), "claude-lock.json"), "utf8")),
    ).resources;
  } catch {
    /* Missing or invalid configuration is reported below. */
  }
  const result = z
    .object({
      agentId: z.string().regex(/^agent_[a-zA-Z0-9]+$/),
      environmentId: z.string().regex(/^env_[a-zA-Z0-9]+$/),
    })
    .safeParse({
      agentId:
        process.env.ANTHROPIC_AGENT_ID ||
        resources["./anthropic/agents/assistant.md"]?.id,
      environmentId:
        process.env.ANTHROPIC_ENVIRONMENT_ID ||
        resources["./anthropic/environments/sandbox.yaml"]?.id,
    });
  if (!result.success)
    throw new Error(
      "Run npm run agent:apply to create the agent and environment, or set ANTHROPIC_AGENT_ID and ANTHROPIC_ENVIRONMENT_ID.",
    );
  return result.data;
}

const shared = globalThis as typeof globalThis & {
  claudeManagedSessions?: InMemorySessionStore;
};

/** Preserve opaque adapter records across hot reloads; use durable storage in production. */
export function sessionStore(): InMemorySessionStore {
  return (shared.claudeManagedSessions ??= new InMemorySessionStore(100));
}
