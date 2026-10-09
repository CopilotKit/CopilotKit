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
