import type { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import { z } from "zod";

const nativeExecutionSchema = z.object({
  version: z.literal(1),
  status: z.literal("ready"),
  source: z.enum([
    "langgraph",
    "adk",
    "mastra",
    "strands-python",
    "strands-typescript",
  ]),
  agentId: z.string().min(1),
  threadId: z.string().min(1),
  context: z.record(z.string(), z.string()),
});

/** Native selectors received from the authorized Intelligence lock response. */
export type ImportedThreadExecution = Required<
  z.infer<typeof nativeExecutionSchema>
>;

/** Server-owned preparation for an imported session's framework-specific context. */
export type PrepareImportedThread = (params: {
  request: Request;
  agent: AbstractAgent;
  execution: ImportedThreadExecution;
  input: RunAgentInput;
}) => Promise<void> | void;

/** A continuation error the caller can repair without losing imported replay. */
export class ImportedThreadExecutionError extends Error {
  readonly code = "IMPORTED_CONTINUATION_UNAVAILABLE";
}

/** Validate the server descriptor before any configured agent or preparation runs. */
export function parseImportedExecution(
  value: unknown,
  agentId: string,
): ImportedThreadExecution | null {
  // Older platforms omit the additive field and retain their released behavior.
  if (value === undefined || value === null) return null;
  const unavailable = z
    .object({
      version: z.literal(1),
      status: z.literal("unavailable"),
      message: z.string().min(1),
    })
    .safeParse(value);
  if (unavailable.success)
    throw new ImportedThreadExecutionError(unavailable.data.message);
  const parsed = nativeExecutionSchema.safeParse(value);
  if (!parsed.success)
    throw new ImportedThreadExecutionError(
      "Imported execution context is unsupported or incomplete. Update Intelligence and the runtime, then re-import using Replace if the problem remains.",
    );
  if (parsed.data.agentId !== agentId)
    throw new ImportedThreadExecutionError(
      "This imported thread belongs to a different mapped agent. Select its mapped agent or correct the import agent mapping.",
    );
  return {
    version: 1,
    status: "ready",
    source: parsed.data.source,
    agentId: parsed.data.agentId,
    threadId: parsed.data.threadId,
    context: parsed.data.context,
  };
}

/** Check the configured local Mastra adapter without changing its routing or store. */
function matchesLocalMastraContext(
  agent: AbstractAgent | undefined,
  execution: ImportedThreadExecution,
): boolean {
  if (!agent || !execution.context.agentId || !execution.context.resourceId)
    return false;
  try {
    if (
      !("isLocalMastraAgent" in agent) ||
      typeof agent.isLocalMastraAgent !== "function" ||
      !("agent" in agent)
    )
      return false;
    const backing = agent.agent;
    if (typeof backing !== "object" || backing === null || !("id" in backing))
      return false;
    const resourceId = "resourceId" in agent ? agent.resourceId : undefined;
    if (resourceId !== undefined && typeof resourceId !== "string")
      return false;
    return (
      agent.isLocalMastraAgent(backing) === true &&
      backing.id === execution.context.agentId &&
      (resourceId ?? execution.threadId) === execution.context.resourceId
    );
  } catch {
    // A custom adapter that cannot inspect its configuration needs explicit preparation.
    return false;
  }
}

/** Reuse configurations whose native selectors already fit the mapped adapter. */
function canUseExistingContext(
  execution: ImportedThreadExecution,
  agent: AbstractAgent | undefined,
): boolean {
  if (execution.source === "langgraph") return true;
  if (execution.source === "adk")
    return (
      execution.context.sessionLookup === "ag-ui-thread" &&
      ["appName", "userId", "sessionId"].every((key) =>
        Boolean(execution.context[key]),
      )
    );
  if (execution.source === "mastra")
    return matchesLocalMastraContext(agent, execution);
  return false;
}

/** Build a separate outbound input; caller-owned canonical identity never changes. */
export function resolveImportedExecution(
  value: unknown,
  agentId: string,
  input: RunAgentInput,
  prepared = false,
  agent?: AbstractAgent,
): RunAgentInput {
  const execution = parseImportedExecution(value, agentId);
  if (!execution) return input;
  if (!prepared && !canUseExistingContext(execution, agent))
    throw new ImportedThreadExecutionError(
      "This framework needs its native session context configured before continuation. Configure prepareImportedThread on the runtime for the mapped agent's original user, resource, or session store.",
    );
  return { ...input, threadId: execution.threadId };
}
