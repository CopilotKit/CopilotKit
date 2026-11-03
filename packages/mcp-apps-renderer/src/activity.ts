// Lightweight, bridge-free surface for MCP Apps activity registration.
//
// This entry re-exports ONLY the pieces that have no dependency on the ext-apps
// AppBridge (the ~40-50 kB gzipped MCP SDK + zod protocol bundle): the activity
// type + content schema (for the host's activity registry) and the ui/message
// follow-up runner. Frontends import these statically to register the MCP-apps
// activity, then load `bindMcpApp` from the package root (`.`) lazily via a
// dynamic import so a non-MCP app never pays for the bridge.
export * from "./constants";
export * from "./content-schema";
export * from "./follow-up";
export {
  McpAppHost as ɵMcpAppHost,
  loadMcpAppsRenderer as ɵloadMcpAppsRenderer,
  MCP_APPS_RENDERER_MISSING_MESSAGE as ɵMCP_APPS_RENDERER_MISSING_MESSAGE,
  MCP_APPS_NO_AGENT_MESSAGE as ɵMCP_APPS_NO_AGENT_MESSAGE,
  MCP_APP_MAX_HEIGHT as ɵMCP_APP_MAX_HEIGHT,
} from "./host";
export type {
  McpAppHostState as ɵMcpAppHostState,
  McpAppHostOptions as ɵMcpAppHostOptions,
  McpAppsRendererImporter as ɵMcpAppsRendererImporter,
} from "./host";
