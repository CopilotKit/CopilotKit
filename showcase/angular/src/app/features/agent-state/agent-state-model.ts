export type StepStatus = "pending" | "in_progress" | "completed";

export interface AgentStep {
  id: string;
  title: string;
  status: StepStatus;
}

export type SubAgentName =
  | "research_agent"
  | "writing_agent"
  | "critique_agent";

export interface Delegation {
  id: string;
  subAgent: SubAgentName;
  task: string;
  status: "completed";
  result: string;
}

/** Read the planner's streamed state without trusting backend payload shapes. */
export function readSteps(state: unknown): AgentStep[] {
  const steps = readArraySlot(state, "steps");
  return steps.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const { id, title, status } = candidate;
    if (
      typeof id !== "string" ||
      typeof title !== "string" ||
      !isStepStatus(status)
    ) {
      return [];
    }
    return [{ id, title, status }];
  });
}

/** Read completed supervisor delegations from append-only agent state. */
export function readDelegations(state: unknown): Delegation[] {
  const delegations = readArraySlot(state, "delegations");
  return delegations.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const { id, sub_agent: subAgent, task, status, result } = candidate;
    if (
      typeof id !== "string" ||
      !isSubAgentName(subAgent) ||
      typeof task !== "string" ||
      status !== "completed" ||
      typeof result !== "string"
    ) {
      return [];
    }
    return [{ id, subAgent, task, status, result }];
  });
}

function readArraySlot(state: unknown, slot: string): unknown[] {
  if (!isRecord(state)) return [];
  const value = state[slot];
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStepStatus(value: unknown): value is StepStatus {
  return (
    value === "pending" || value === "in_progress" || value === "completed"
  );
}

function isSubAgentName(value: unknown): value is SubAgentName {
  return (
    value === "research_agent" ||
    value === "writing_agent" ||
    value === "critique_agent"
  );
}
