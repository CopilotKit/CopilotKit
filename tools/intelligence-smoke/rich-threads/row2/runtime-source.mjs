/** MCP Apps middleware owns ACTIVITY_SNAPSHOT presentation resources. Their
 * absence from a framework which never received/emitted them is a source
 * limitation, separate from persistence of its real MCP tool calls/results.
 */
const isMcpActivity = (value) =>
  value && typeof value === "object" && value.activityType === "mcp-apps";

export function runtimeMcpLimitation(boundary) {
  if (!Array.isArray(boundary.frameworkRuns) || !boundary.frameworkRuns.length)
    throw new Error(
      "Independent framework capture required for runtime source classification",
    );
  const contains = (value) => {
    if (!value || typeof value !== "object") return false;
    return isMcpActivity(value) || Object.values(value).some(contains);
  };
  const runtime = (boundary.events ?? []).filter(
    (event) =>
      event.type === "ACTIVITY_SNAPSHOT" &&
      isMcpActivity(event) &&
      typeof event.content?.resourceUri === "string" &&
      event.content.resourceUri &&
      event.content.result,
  );
  if (!runtime.length || contains(boundary.frameworkRuns)) return null;
  return {
    status: "source-limitation",
    reason:
      "MCP Apps presentation activity was emitted by runtime middleware; no corresponding activity entered or left the framework boundary. Native tool calls/results are checked separately.",
    runtimeActivities: runtime,
  };
}
