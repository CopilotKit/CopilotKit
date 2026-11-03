export type CapabilityToolRow = {
  key: string;
  name: string;
  description?: string;
  agentId?: string;
  enabled: boolean;
};

export type CapabilityToolSource = {
  tools?: ReadonlyArray<{
    name: string;
    description?: string;
    agentId?: string;
  }>;
  isToolEnabled: (name: string, agentId?: string) => boolean;
};

export function buildCapabilityRows(
  core: CapabilityToolSource,
): CapabilityToolRow[] {
  return (core.tools ?? [])
    .map((tool) => ({
      key: `${tool.agentId ?? ""}:${tool.name}`,
      name: tool.name,
      description: tool.description,
      agentId: tool.agentId,
      enabled: core.isToolEnabled(tool.name, tool.agentId),
    }))
    .sort((left, right) => {
      const agentComparison = (left.agentId ?? "").localeCompare(
        right.agentId ?? "",
      );
      return agentComparison || left.name.localeCompare(right.name);
    });
}
