import type { RunAgentInput } from "@ag-ui/client";
import type { ToolSet } from "ai";
import { z } from "zod";

/** Container key the A2UI middleware looks for in tool results. */
export const A2UI_OPERATIONS_KEY = "a2ui_operations";

/** Default name A2UIMiddleware injects when `injectA2UITool` is true. */
export const DEFAULT_A2UI_RENDER_TOOL_NAME = "render_a2ui";

const BASIC_A2UI_CATALOG_ID =
  "https://a2ui.org/specification/v0_9/basic_catalog.json";

/**
 * Permissive input schema for the injected render tool. The middleware's JSON
 * Schema uses `components.items: { type: "object" }` with no properties, which
 * `convertJsonSchemaToZodSchema` turns into `z.object({})` and strips every
 * component field. A2UI components are open objects by design.
 */
export const A2UI_RENDER_TOOL_INPUT_SCHEMA = z.object({
  surfaceId: z.string().optional(),
  components: z.array(z.record(z.string(), z.any())).optional(),
  data: z.any().optional(),
});

const A2UI_SCHEMA_CONTEXT_MARKERS = ["A2UI Component Schema", "A2UI catalog"];

/**
 * Names of A2UI *render* tools on this run. The middleware injects
 * `render_a2ui` by default, or a custom name when `injectA2UITool` is a string.
 */
export function a2uiRenderToolNames(input: RunAgentInput): Set<string> {
  const names = new Set<string>([DEFAULT_A2UI_RENDER_TOOL_NAME]);
  const injected = (
    input.forwardedProps as { injectA2UITool?: unknown } | undefined
  )?.injectA2UITool;
  if (typeof injected === "string" && injected.length > 0) {
    names.add(injected);
  }
  return names;
}

/**
 * Catalog id the frontend registered, read from the A2UI schema context entry
 * the renderer ships on every run. Falls back to the v0.9 basic catalog.
 */
export function catalogIdFromA2UIContext(input: RunAgentInput): string {
  for (const entry of input.context ?? []) {
    const description = entry.description ?? "";
    const matchesSchemaContext = A2UI_SCHEMA_CONTEXT_MARKERS.some((marker) =>
      description.includes(marker),
    );
    if (!matchesSchemaContext) continue;
    if (typeof entry.value !== "string") continue;
    try {
      const parsed = JSON.parse(entry.value) as { catalogId?: unknown };
      const catalogId = parsed?.catalogId;
      if (typeof catalogId === "string" && catalogId.length > 0) {
        return catalogId;
      }
    } catch {
      // Unparseable schema context — use the basic catalog.
    }
  }
  return BASIC_A2UI_CATALOG_ID;
}

/**
 * Turn a `render_a2ui` argument payload into the `a2ui_operations` envelope
 * the A2UI middleware paints from `TOOL_CALL_RESULT`.
 */
export function buildA2uiOperationsFromRenderArgs(
  args: Record<string, unknown>,
  catalogId: string,
): { [A2UI_OPERATIONS_KEY]: Array<Record<string, unknown>> } {
  const surfaceId =
    typeof args.surfaceId === "string" && args.surfaceId.length > 0
      ? args.surfaceId
      : "dynamic-surface";
  const components = Array.isArray(args.components) ? args.components : [];
  const ops: Array<Record<string, unknown>> = [
    { version: "v0.9", createSurface: { surfaceId, catalogId } },
    { version: "v0.9", updateComponents: { surfaceId, components } },
  ];
  const data = args.data;
  if (
    data != null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    Object.keys(data as object).length > 0
  ) {
    ops.push({
      version: "v0.9",
      updateDataModel: { surfaceId, path: "/", value: data },
    });
  }
  return { [A2UI_OPERATIONS_KEY]: ops };
}

/**
 * `render_a2ui` is injected by A2UIMiddleware with no `execute`. BuiltInAgent
 * otherwise advertises it as a client tool, so the run ends with raw
 * TOOL_CALL_* events and no `a2ui_operations` result — the chat skeleton
 * never resolves. Attach a local executor that returns the envelope the
 * middleware already knows how to paint.
 *
 * An existing `execute` (a host-owned generate/render tool) is left alone.
 */
export function withA2UIRenderToolExecutors(
  tools: ToolSet,
  input: RunAgentInput,
): ToolSet {
  const names = a2uiRenderToolNames(input);
  const catalogId = catalogIdFromA2UIContext(input);
  const next: ToolSet = { ...tools };
  let changed = false;

  for (const name of names) {
    const tool = next[name];
    if (
      !tool ||
      typeof tool !== "object" ||
      typeof tool.execute === "function"
    ) {
      continue;
    }
    next[name] = {
      ...(tool as object),
      inputSchema: A2UI_RENDER_TOOL_INPUT_SCHEMA,
      execute: async (args: Record<string, unknown>) =>
        buildA2uiOperationsFromRenderArgs(args ?? {}, catalogId),
    } as (typeof next)[string];
    changed = true;
  }

  return changed ? next : tools;
}
