import {
  A2UI_DEFAULT_DESIGN_GUIDELINES,
  A2UI_DEFAULT_GENERATION_GUIDELINES,
} from "@copilotkit/shared";
import {
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  buildCatalogContextValue,
  extractCatalogComponentSchemas,
} from "./catalog-description";
import type { CatalogSchemaSource } from "./catalog-description";

/** One agent context entry, as `CopilotKitCore.addContext` takes it. */
export interface A2UIContextEntry {
  description: string;
  value: string;
  agentIds?: string[];
}

export const A2UI_CAPABILITIES_CONTEXT_DESCRIPTION =
  "A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.";
export const A2UI_GENERATION_GUIDELINES_CONTEXT_DESCRIPTION =
  "A2UI generation guidelines — protocol rules, tool arguments, path rules, data model format, and form/two-way-binding instructions.";
export const A2UI_DESIGN_GUIDELINES_CONTEXT_DESCRIPTION =
  "A2UI design guidelines — visual design rules, component hierarchy tips, and action handler patterns.";

/**
 * The agent context entries that describe an A2UI catalog: its capabilities
 * always; its component schemas and the generation and design guidelines
 * unless `includeSchema` is `false`. The schema entry uses the description
 * the A2UI middleware looks for, so a server-side schema can replace it.
 *
 * @param catalog - The catalog the client renders.
 * @param options.includeSchema - Send the schemas and guidelines. Default true.
 * @param options.agentIds - Scope every entry to these agents, the ones the
 *   runtime applies A2UI to (`core.a2uiAgents`, #5369). All agents when absent.
 */
export function buildA2UIContextEntries(
  catalog: CatalogSchemaSource,
  options: { includeSchema?: boolean; agentIds?: string[] } = {},
) {
  const includeSchema = options.includeSchema !== false;
  const scope = options.agentIds ? { agentIds: options.agentIds } : {};
  const entries: A2UIContextEntry[] = [
    {
      description: A2UI_CAPABILITIES_CONTEXT_DESCRIPTION,
      value: buildCatalogContextValue(catalog, { includeSchema }),
      ...scope,
    },
  ];
  if (!includeSchema) return entries;
  entries.push(
    {
      description: A2UI_SCHEMA_CONTEXT_DESCRIPTION,
      value: JSON.stringify(extractCatalogComponentSchemas(catalog)),
      ...scope,
    },
    {
      description: A2UI_GENERATION_GUIDELINES_CONTEXT_DESCRIPTION,
      value: A2UI_DEFAULT_GENERATION_GUIDELINES,
      ...scope,
    },
    {
      description: A2UI_DESIGN_GUIDELINES_CONTEXT_DESCRIPTION,
      value: A2UI_DEFAULT_DESIGN_GUIDELINES,
      ...scope,
    },
  );
  return entries;
}
