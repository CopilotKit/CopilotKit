// Web Component surface for MCP Apps.
//
// The `<copilotkit-mcp-app>` custom element (which owns the sandbox iframe + the
// ext-apps bridge via bindMcpApp, and renders inline/fullscreen without
// remounting the iframe) lands in a follow-up. This entry exposes the tag name
// now so the package's export map is stable.
export const COPILOTKIT_MCP_APP_TAG = "copilotkit-mcp-app" as const;
