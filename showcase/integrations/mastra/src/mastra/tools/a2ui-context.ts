/**
 * Server-side read of the A2UI schema context the `@ag-ui/mastra` bridge
 * forwards onto Mastra's request context.
 *
 * The bridge does `requestContext.set("ag-ui", { context })` with
 * `RunAgentInput.context`, which carries the catalog schema + A2UI generation
 * guidelines the middleware injected. The dynamic `generate_a2ui` tool must
 * ground its inner `render_a2ui` subagent on this — the outer model leaves the
 * tool's `contextEntries` arg empty, so without reading it here the render runs
 * with no catalog and produces invalid/misnamed components (no surface renders;
 * varies run to run; masked under aimock). Mirrors `readAgUiContext` in
 * `@ag-ui/mastra`'s `getA2UITools`. Degrades to `[]` for any unexpected shape.
 */
export function readForwardedA2uiContext(
  executionContext: unknown,
): Array<Record<string, unknown>> {
  const requestContext = (
    executionContext as { requestContext?: { get?: (key: string) => unknown } }
  )?.requestContext;
  const entry =
    typeof requestContext?.get === "function"
      ? requestContext.get("ag-ui")
      : undefined;
  const context = (entry as { context?: unknown } | undefined)?.context;
  return Array.isArray(context)
    ? (context as Array<Record<string, unknown>>)
    : [];
}

/**
 * Flatten forwarded context entries into the system prompt for the inner
 * `render_a2ui` call. Entries without a non-empty string `value` are dropped,
 * so an empty (ungrounded) prompt is `""` rather than a string of blanks.
 */
export function systemPromptFrom(
  contextEntries: Array<Record<string, unknown>> | undefined,
): string {
  return (contextEntries ?? [])
    .map((entry) => entry?.value)
    .filter((value): value is string => typeof value === "string" && !!value)
    .join("\n\n");
}
