export type SubagentParent = {
  parentSubagentRunId?: string;
};

export type HierarchicalLineKind =
  | "started"
  | "finished"
  | "text"
  | "tool"
  | "result";

/**
 * Resolve a subagent's nesting depth from durable parent identity.
 *
 * Missing ancestors still count as one level because the child explicitly
 * names a parent. A cycle is bounded rather than hanging the UI.
 */
export function resolveSubagentDepth(
  subagents: ReadonlyMap<string, SubagentParent>,
  subagentRunId: string,
): number {
  let depth = 0;
  let current = subagentRunId;
  const seen = new Set<string>();

  while (!seen.has(current)) {
    seen.add(current);
    const parent = subagents.get(current)?.parentSubagentRunId;
    if (!parent) return depth;
    depth += 1;
    current = parent;
  }

  return depth;
}

/**
 * Activity inside a subagent sits below that subagent's own heading.
 * Tool results sit one level below the tool invocation they answer.
 */
export function resolveSubagentLineDepth(
  subagents: ReadonlyMap<string, SubagentParent>,
  subagentRunId: string,
  kind: HierarchicalLineKind,
): number {
  const localDepth =
    kind === "started" || kind === "finished" ? 0 : kind === "result" ? 2 : 1;
  return resolveSubagentDepth(subagents, subagentRunId) + localDepth;
}
