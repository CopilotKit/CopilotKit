/**
 * Programmatic working-memory writers for tools that own UI-visible state.
 *
 * Why this exists: Mastra's default working-memory contract is LLM-driven —
 * the agent's system prompt asks the model to call `updateWorkingMemory`
 * (or to "update working memory with the same payload"). That is
 * non-deterministic: any turn where the LLM forgets the call leaves the UI's
 * state stale. For demos whose entire purpose is to surface a backend-owned
 * shared-state slot to the UI (notes panel, delegation log), that is a
 * silent UX bug.
 *
 * Pattern: each "owning" tool calls one of the helpers below from inside its
 * `execute`. The helper:
 *
 *   1. Resolves the agent instance via `mastra.getAgentById(agentId)`.
 *   2. Pulls the agent's Memory via `agent.getMemory()`.
 *   3. Reads the existing working memory (JSON-shaped because the agent
 *      declares a working-memory schema — see `agents/index.ts`).
 *   4. Merges the new field(s) into the existing payload.
 *   5. Calls `memory.updateWorkingMemory({ threadId, resourceId, workingMemory })`
 *      with the JSON-stringified merged payload.
 *
 * On any failure (no agent, no memory, no threadId/resourceId, write throws)
 * we log a structured error and continue: the tool's primary effect (running
 * the LLM call, computing the result) still completes. The caller decides
 * whether to surface the failure to the UI; today both call sites just emit
 * a "[working-memory write failed]" breadcrumb in the server log because the
 * delegation/notes update is a fire-and-forget side effect, not the tool's
 * core return value.
 *
 * Resilience to API drift: this whole file is best-effort. The Mastra Memory
 * surface is in beta and subject to change. We feature-detect each method
 * before calling it and degrade gracefully when something is missing — that
 * way an upgrade that renames a method causes a logged warning instead of a
 * broken demo.
 */

/**
 * Shape of the slice of `ToolExecutionContext` we actually consume. We keep
 * this typed loosely (Record<string, unknown>) so we don't pin to the exact
 * Mastra tool-context internal shape — the bits we need (`agent.threadId`,
 * `agent.resourceId`, `mastra`) are stable but adjacent fields in
 * `ToolExecutionContext` change between Mastra beta releases.
 */
export interface MaybeToolExecutionContext {
  agent?: {
    agentId?: string;
    threadId?: string;
    resourceId?: string;
  };
  mastra?: {
    getAgentById?: (id: string) => unknown;
    getAgent?: (id: string) => unknown;
  };
  threadId?: string;
  resourceId?: string;
}

interface MemoryLike {
  getWorkingMemory?: (args: {
    threadId?: string;
    resourceId?: string;
  }) => Promise<unknown>;
  updateWorkingMemory: (args: {
    threadId?: string;
    resourceId?: string;
    workingMemory: string;
  }) => Promise<unknown>;
}

interface AgentLike {
  getMemory?: () => unknown;
}

function logWorkingMemoryFailure(
  component: string,
  reason: string,
  err?: unknown,
): void {
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      level: "error",
      component,
      message: `working-memory write failed: ${reason}`,
      errorClass:
        err instanceof Error
          ? err.constructor.name
          : err
            ? "UnknownError"
            : undefined,
      detail:
        err instanceof Error ? err.message : err ? String(err) : undefined,
    }),
  );
}

async function resolveMemoryAndIds(
  ctx: MaybeToolExecutionContext,
  agentId: string,
  component: string,
): Promise<{
  memory: MemoryLike;
  threadId?: string;
  resourceId?: string;
} | null> {
  const threadId = ctx.agent?.threadId ?? ctx.threadId;
  const resourceId = ctx.agent?.resourceId ?? ctx.resourceId;
  if (!threadId && !resourceId) {
    logWorkingMemoryFailure(
      component,
      "no threadId or resourceId on tool execution context",
    );
    return null;
  }
  const mastra = ctx.mastra;
  if (!mastra) {
    logWorkingMemoryFailure(component, "no mastra on tool execution context");
    return null;
  }
  let agent: unknown;
  try {
    if (typeof mastra.getAgentById === "function") {
      agent = mastra.getAgentById(agentId);
    } else if (typeof mastra.getAgent === "function") {
      agent = mastra.getAgent(agentId);
    } else {
      logWorkingMemoryFailure(
        component,
        "mastra has no getAgentById/getAgent method",
      );
      return null;
    }
  } catch (err) {
    logWorkingMemoryFailure(component, "mastra.getAgentById threw", err);
    return null;
  }
  const a = agent as AgentLike | undefined;
  if (!a || typeof a.getMemory !== "function") {
    logWorkingMemoryFailure(
      component,
      `agent ${agentId} has no getMemory method`,
    );
    return null;
  }
  let memory: unknown;
  try {
    memory = a.getMemory();
  } catch (err) {
    logWorkingMemoryFailure(component, "agent.getMemory threw", err);
    return null;
  }
  if (
    !memory ||
    typeof (memory as MemoryLike).updateWorkingMemory !== "function"
  ) {
    logWorkingMemoryFailure(
      component,
      `agent ${agentId} memory has no updateWorkingMemory method`,
    );
    return null;
  }
  return { memory: memory as MemoryLike, threadId, resourceId };
}

async function readExistingWorkingMemory(
  memory: MemoryLike,
  threadId: string | undefined,
  resourceId: string | undefined,
): Promise<Record<string, unknown>> {
  if (typeof memory.getWorkingMemory !== "function") {
    return {};
  }
  let raw: unknown;
  try {
    raw = await memory.getWorkingMemory({ threadId, resourceId });
  } catch {
    return {};
  }
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") {
    return raw as Record<string, unknown>;
  }
  return {};
}

/**
 * Append a delegation entry to the supervisor agent's `delegations` array in
 * working memory. Determinism guarantee: this is what drives the UI's live
 * delegation log — it MUST run on every supervisor tool call, regardless of
 * whether the LLM remembers to mention the delegation in its next turn.
 */
export async function writeDelegationsToWorkingMemory(
  ctx: MaybeToolExecutionContext,
  newDelegation: Record<string, unknown>,
): Promise<void> {
  const component = "subagents";
  const agentId = ctx.agent?.agentId ?? "subagentsSupervisorAgent";
  const resolved = await resolveMemoryAndIds(ctx, agentId, component);
  if (!resolved) return;
  try {
    const existing = await readExistingWorkingMemory(
      resolved.memory,
      resolved.threadId,
      resolved.resourceId,
    );
    const existingDelegations = Array.isArray(existing.delegations)
      ? (existing.delegations as unknown[])
      : [];
    const merged: Record<string, unknown> = {
      ...existing,
      delegations: [...existingDelegations, newDelegation],
    };
    await resolved.memory.updateWorkingMemory({
      threadId: resolved.threadId,
      resourceId: resolved.resourceId,
      workingMemory: JSON.stringify(merged),
    });
  } catch (err) {
    logWorkingMemoryFailure(component, "updateWorkingMemory threw", err);
  }
}

/**
 * Replace the `notes` array in the shared-state-read-write agent's working
 * memory. Determinism guarantee: the UI's notes panel is sourced directly
 * from this slot, so the write must happen on every `set_notes` tool call.
 */
export async function writeNotesToWorkingMemory(
  ctx: MaybeToolExecutionContext,
  notes: string[],
): Promise<void> {
  const component = "shared-state-read-write";
  const agentId = ctx.agent?.agentId ?? "sharedStateReadWriteAgent";
  const resolved = await resolveMemoryAndIds(ctx, agentId, component);
  if (!resolved) return;
  try {
    const existing = await readExistingWorkingMemory(
      resolved.memory,
      resolved.threadId,
      resolved.resourceId,
    );
    const merged: Record<string, unknown> = {
      ...existing,
      notes,
    };
    await resolved.memory.updateWorkingMemory({
      threadId: resolved.threadId,
      resourceId: resolved.resourceId,
      workingMemory: JSON.stringify(merged),
    });
  } catch (err) {
    logWorkingMemoryFailure(component, "updateWorkingMemory threw", err);
  }
}
