// @copilotkit/mcp-apps-renderer - framework-agnostic MCP Apps host.
//
// This package owns the app<->host protocol (ext-apps AppBridge), the sandbox
// proxy, the per-thread request queue, ui/message extensions, and the shared
// content schema. The React/Vue/Angular renderers consume it as thin adapters
// (they only mount the iframe and wire reactive state); ext-apps + the MCP SDK
// are declared here and nowhere else.

export * from "./constants";
export * from "./content-schema";
export * from "./sandbox";
export * from "./request-queue";
export * from "./follow-up";
