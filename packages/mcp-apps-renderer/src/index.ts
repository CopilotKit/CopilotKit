// @copilotkit/mcp-apps-renderer - framework-agnostic MCP Apps host.
//
// This package owns the app<->host protocol (ext-apps AppBridge), the sandbox
// proxy, and the per-thread request queue. The React/Vue/Angular renderers
// consume it as thin adapters (they only mount the iframe and wire reactive
// state); ext-apps + the MCP SDK are declared here and nowhere else. The
// bridge-free activity surface (type, content schema, follow-up runner) lives
// in `@copilotkit/shared`, so frontends can register the activity without this
// package installed - it is an optional peer of the adapters.

export * from "./constants";
export * from "./content-schema";
export * from "./sandbox";
export * from "./request-queue";
export * from "./follow-up";
export * from "./session";
