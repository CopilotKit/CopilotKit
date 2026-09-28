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

/** Build a separate outbound input; caller-owned canonical identity never changes. */
export function resolveImportedExecution(
  value: unknown,
  agentId: string,
  input: RunAgentInput,
  prepared = false,
): RunAgentInput {
  const execution = parseImportedExecution(value, agentId);
  if (!execution) return input;
  if (execution.source !== "langgraph" && !prepared)
    throw new ImportedThreadExecutionError(
      "This framework needs its native session context configured before continuation. Configure prepareImportedThread on the runtime for the mapped agent's original user, resource, or session store.",
    );
  return { ...input, threadId: execution.threadId };
}
