const FRONTEND_TOOL_SCHEDULING_INTEGRATIONS = new Set(["google-adk"]);

/**
 * Identify backends that implement the interrupt demo with a frontend
 * `schedule_meeting` tool instead of emitting an AG-UI interrupt event.
 */
export function usesFrontendSchedulingTool(
  feature: string,
  integration: string,
): boolean {
  return (
    feature === "gen-ui-interrupt" &&
    FRONTEND_TOOL_SCHEDULING_INTEGRATIONS.has(integration)
  );
}
