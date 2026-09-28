import type { ToolSet } from "ai";

/** The tools that one MCP source contributed, with the label used to prefix them. */
export interface MCPToolSource {
  label: string;
  tools: ToolSet;
}

/**
 * Reduces a server name to the characters that model providers accept in a
 * tool name (`^[a-zA-Z0-9_-]+$`).
 */
export function toToolNamePrefix(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// A collision is usually permanent configuration, and agents resolve tools on
// every run. Warning each time would repeat one message for every request.
const warnedCollisions = new Set<string>();

/**
 * Chooses the name under which each MCP tool is exposed, so that no tool is
 * dropped or replaced.
 *
 * A tool name that more than one MCP source exposes is prefixed with each
 * source's label, so the model sees every copy. A tool name that the app
 * already uses keeps the app's tool, and the MCP copy is prefixed. Names that
 * collide with nothing are left as they are, so adding a server does not
 * rename tools that apps and prompts already use.
 *
 * @returns For each source, the exposed names in the same order as `names`.
 */
export function resolveMCPToolNames(
  appToolNames: ReadonlySet<string>,
  sources: { label: string; names: string[] }[],
  hint = " Set `name` on each MCP server to choose the prefix.",
): string[][] {
  const sourceCount = new Map<string, number>();
  for (const { names } of sources) {
    for (const name of new Set(names)) {
      sourceCount.set(name, (sourceCount.get(name) ?? 0) + 1);
    }
  }

  const renamed = new Map<string, string[]>();
  const resolved = sources.map(({ label, names }) =>
    names.map((name) => {
      if ((sourceCount.get(name) ?? 0) < 2 && !appToolNames.has(name)) {
        return name;
      }
      const prefixed = `${label}_${name}`;
      renamed.set(name, [...(renamed.get(name) ?? []), prefixed]);
      return prefixed;
    }),
  );

  for (const [name, prefixed] of renamed) {
    const owner = appToolNames.has(name)
      ? " The app's own tool keeps the name."
      : "";
    const message = `[CopilotKit] MCP tool name "${name}" is used more than once, so the MCP copies are exposed as ${prefixed
      .map((n) => `"${n}"`)
      .join(", ")}.${owner}${hint}`;
    if (warnedCollisions.has(message)) continue;
    warnedCollisions.add(message);
    console.warn(message);
  }

  return resolved;
}

/** Merges MCP tools into the agent's own tools under {@link resolveMCPToolNames}. */
export function mergeMCPTools(
  appTools: ToolSet,
  sources: MCPToolSource[],
): ToolSet {
  const entries = sources.map((source) => Object.entries(source.tools));
  const names = resolveMCPToolNames(
    new Set(Object.keys(appTools)),
    sources.map((source, i) => ({
      label: source.label,
      names: entries[i]!.map(([name]) => name),
    })),
  );

  const merged: ToolSet = { ...appTools };
  entries.forEach((sourceEntries, i) => {
    sourceEntries.forEach(([, tool], j) => {
      merged[names[i]![j]!] = tool;
    });
  });
  return merged;
}
