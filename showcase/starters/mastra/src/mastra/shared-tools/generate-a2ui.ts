/**
 * Dynamic A2UI generation via secondary LLM call.
 * TypeScript equivalent of showcase/shared/python/tools/generate_a2ui.py.
 */

export const CUSTOM_CATALOG_ID = "copilotkit://app-dashboard-catalog";

export const RENDER_A2UI_TOOL_SCHEMA = {
  name: "render_a2ui",
  description: "Render a dynamic A2UI v0.9 surface.",
  parameters: {
    type: "object",
    properties: {
      surfaceId: { type: "string", description: "Unique surface identifier." },
      catalogId: { type: "string", description: "The catalog ID." },
      components: {
        type: "array",
        items: { type: "object" },
        description: "A2UI v0.9 component array (flat format).",
      },
      data: {
        type: "object",
        description: "Optional initial data model for the surface.",
      },
    },
    required: ["surfaceId", "catalogId", "components"],
  },
} as const;

export interface GenerateA2UIInput {
  messages: Array<Record<string, unknown>>;
  contextEntries?: Array<Record<string, unknown>>;
}

export interface GenerateA2UIResult {
  systemPrompt: string;
  toolSchema: typeof RENDER_A2UI_TOOL_SCHEMA;
  toolChoice: string;
  messages: Array<Record<string, unknown>>;
  catalogId: string;
}

export function generateA2uiImpl(input: GenerateA2UIInput): GenerateA2UIResult {
  const contextText = (input.contextEntries ?? [])
    .filter(
      (e): e is Record<string, unknown> & { value: string } =>
        typeof e === "object" &&
        typeof e.value === "string" &&
        e.value.length > 0,
    )
    .map((e) => e.value)
    .join("\n\n");

  return {
    systemPrompt: contextText,
    toolSchema: RENDER_A2UI_TOOL_SCHEMA,
    toolChoice: "render_a2ui",
    messages: input.messages,
    catalogId: CUSTOM_CATALOG_ID,
  };
}

export interface A2UIOperation {
  type: "create_surface" | "update_components" | "update_data_model";
  surfaceId: string;
  catalogId?: string;
  components?: Array<Record<string, unknown>>;
  data?: Record<string, unknown>;
}

export function buildA2uiOperationsFromToolCall(
  args: Record<string, unknown>,
): {
  a2ui_operations: A2UIOperation[];
} {
  const surfaceId = (args.surfaceId as string) ?? "dynamic-surface";
  const catalogId = (args.catalogId as string) ?? CUSTOM_CATALOG_ID;
  const components = (args.components as Array<Record<string, unknown>>) ?? [];
  const data = args.data as Record<string, unknown> | undefined;

  if (components.length === 0) {
    console.warn(
      "buildA2uiOperationsFromToolCall: empty components for surface",
      surfaceId,
    );
  }

  const ops: A2UIOperation[] = [
    { type: "create_surface", surfaceId, catalogId },
    { type: "update_components", surfaceId, components },
  ];

  if (data) {
    ops.push({ type: "update_data_model", surfaceId, data });
  }

  return { a2ui_operations: ops };
}
