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

// v1 requests can choose their own MCP servers, so the set of distinct
// messages has no natural bound. Forgetting old ones costs a repeated warning.
const MAX_WARNED_COLLISIONS = 1000;

function warnOnce(message: string): void {
  if (warnedCollisions.has(message)) return;
  if (warnedCollisions.size >= MAX_WARNED_COLLISIONS) warnedCollisions.clear();
  warnedCollisions.add(message);
  console.warn(message);
}

/**
 * Chooses the name under which each MCP tool is exposed, so that no tool is
 * dropped or replaced.
 *
 * A tool name that more than one MCP source exposes is prefixed with each
 * source's label, so the model sees every copy. A tool name that the app
 * already uses keeps the app's tool, and the MCP copy is prefixed. Names that
 * collide with nothing are left as they are, so adding a server does not
 * rename tools that apps and prompts already use. If a prefixed name is
 * already in use, for example because two servers share a label, a number is
 * added: `<label>_<tool>_2`.
 *
 * @returns For each source, the exposed names in the same order as `names`.
 */
export function resolveMCPToolNames(
  appToolNames: ReadonlySet<string>,
  sources: { label: string; names: string[] }[],
  hint = " Set `name` on an `mcpServers` entry to choose its prefix. `mcpClients` entries always use `mcp<N>`.",
): string[][] {
  const sourceCount = new Map<string, number>();
  for (const { names } of sources) {
    for (const name of new Set(names)) {
      sourceCount.set(name, (sourceCount.get(name) ?? 0) + 1);
    }
  }
  const collides = (name: string) =>
    (sourceCount.get(name) ?? 0) > 1 || appToolNames.has(name);

  // Names that keep their bare form are reserved before any prefixed name is
  // chosen, so a prefixed name can never replace one of them.
  const taken = new Set(appToolNames);
  for (const { names } of sources) {
    for (const name of names) if (!collides(name)) taken.add(name);
  }

  const renamed = new Map<string, string[]>();
  const numberedLabels = new Set<string>();
  const resolved = sources.map(({ label, names }) =>
    names.map((name) => {
      if (!collides(name)) return name;
      let prefixed = `${label}_${name}`;
      for (let n = 2; taken.has(prefixed); n++) {
        prefixed = `${label}_${name}_${n}`;
        numberedLabels.add(label);
      }
      taken.add(prefixed);
      renamed.set(name, [...(renamed.get(name) ?? []), prefixed]);
      return prefixed;
    }),
  );

  const labelCount = new Map<string, number>();
  for (const { label } of sources) {
    labelCount.set(label, (labelCount.get(label) ?? 0) + 1);
  }
  for (const [label, count] of labelCount) {
    if (count < 2 || !numberedLabels.has(label)) continue;
    warnOnce(
      `[CopilotKit] More than one MCP server uses the prefix "${label}", so their colliding tools differ only by a number. Give each server a different \`name\`.`,
    );
  }

  for (const [name, prefixed] of renamed) {
    const owner = appToolNames.has(name)
      ? " The app's own tool keeps the name."
      : "";
    warnOnce(
      `[CopilotKit] MCP tool name "${name}" is used more than once, so the MCP copies are exposed as ${prefixed
        .map((n) => `"${n}"`)
        .join(", ")}.${owner}${hint}`,
    );
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
