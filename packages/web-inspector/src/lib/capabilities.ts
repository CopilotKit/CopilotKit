// ─── Capabilities tab view-models ────────────────────────────────────────────
// A single toggle row. `key` is the stable identity used as a Lit list key; for
// tools it is `${agentId}:${name}` (agentId "" for global tools), for catalog
// components it is the component name.
export type CapabilityToolRow = {
  key: string;
  name: string;
  description?: string;
  agentId?: string;
  enabled: boolean;
};

// Minimal structural view of CopilotKitCore that the pure helper needs, so
// buildCapabilityRows is trivially unit-testable with a plain object. Method
// names MUST match the A1 contract exactly.
export type CapabilityToolSource = {
  tools?: ReadonlyArray<{
    name: string;
    description?: string;
    agentId?: string;
  }>;
  isToolEnabled: (name: string, agentId?: string) => boolean;
};

/**
 * Map core.tools (the registry INCLUDING disabled tools) into Capabilities-tab
 * frontend-tool rows. Pure: no DOM, no `this`. Reads current on/off state from
 * core.isToolEnabled(name, agentId?) per the A1 contract.
 */
export function buildCapabilityRows(
  core: CapabilityToolSource,
): CapabilityToolRow[] {
  const rows: CapabilityToolRow[] = [];
  for (const tool of core.tools ?? []) {
    const agentId = tool.agentId ?? "";
    const key = `${agentId}:${tool.name}`;
    rows.push({
      key,
      name: tool.name,
      description: tool.description,
      agentId: tool.agentId,
      enabled: core.isToolEnabled(tool.name, tool.agentId),
    });
  }
  return rows.sort((a, b) => {
    const agentCompare = (a.agentId ?? "").localeCompare(b.agentId ?? "");
    if (agentCompare !== 0) return agentCompare;
    return a.name.localeCompare(b.name);
  });
}
