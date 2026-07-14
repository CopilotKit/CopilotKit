/**
 * Dynamic A2UI generation via secondary LLM call.
 * TypeScript equivalent of showcase/shared/python/tools/generate_a2ui.py.
 */

export const CUSTOM_CATALOG_ID = "copilotkit://app-dashboard-catalog";

export const DESIGN_A2UI_SURFACE_TOOL_SCHEMA = {
  name: "_design_a2ui_surface",
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
  toolSchema: typeof DESIGN_A2UI_SURFACE_TOOL_SCHEMA;
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
    toolSchema: DESIGN_A2UI_SURFACE_TOOL_SCHEMA,
    toolChoice: "_design_a2ui_surface",
    messages: input.messages,
    catalogId: CUSTOM_CATALOG_ID,
  };
}

/**
 * A2UI v0.9 nested operation shape. A2UI consumers process operations by
 * their nested `createSurface` / `updateComponents` / `updateDataModel`
 * keys; the legacy flat shape (`{ type: "create_surface", surfaceId }`) is
 * not processed as a valid nested operation, so the surface's schema and
 * components are never applied. The operation ENVELOPE shape here mirrors
 * Python's `build_a2ui_operations_from_tool_call` in
 * showcase/shared/python/tools/generate_a2ui.py (TS does NOT yet replicate
 * Python's component sanitization — that's a separate follow-up).
 */
export type A2UIOperation =
  | { version: "v0.9"; createSurface: { surfaceId: string; catalogId: string } }
  | {
      version: "v0.9";
      updateComponents: {
        surfaceId: string;
        components: Array<Record<string, unknown>>;
      };
    }
  | {
      version: "v0.9";
      updateDataModel: {
        surfaceId: string;
        path: string;
        value: Record<string, unknown>;
      };
    };

export function buildA2uiOperationsFromToolCall(
  args: Record<string, unknown>,
): {
  a2ui_operations: A2UIOperation[];
} {
  const surfaceId = (args.surfaceId as string) ?? "dynamic-surface";
  const catalogId = (args.catalogId as string) ?? CUSTOM_CATALOG_ID;
  const components = (args.components as Array<Record<string, unknown>>) ?? [];
  const data = args.data as Record<string, unknown> | undefined;
  // Python uses `if data:` — an empty dict `{}` is falsy and emits no
  // updateDataModel op. `{}` is truthy in JS, so guard on a non-empty object
  // to keep parity with generate_a2ui.py.
  const hasData =
    data != null && typeof data === "object" && Object.keys(data).length > 0;

  if (components.length === 0) {
    console.warn(
      "buildA2uiOperationsFromToolCall: empty components for surface",
      surfaceId,
    );
  }

  const ops: A2UIOperation[] = [
    { version: "v0.9", createSurface: { surfaceId, catalogId } },
    { version: "v0.9", updateComponents: { surfaceId, components } },
  ];

  if (hasData) {
    ops.push({
      version: "v0.9",
      updateDataModel: { surfaceId, path: "/", value: data },
    });
  }

  return { a2ui_operations: ops };
}
