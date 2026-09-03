// Web Component surface for MCP Apps.
//
// `<copilotkit-mcp-app>` owns the sandbox iframe + the ext-apps bridge (via
// bindMcpApp) and renders it without remounting the iframe across re-renders or
// property updates. Import from here for the class/tag; import `./define` for
// the side-effecting `customElements.define` registration.
export { CopilotKitMcpApp } from "./mcp-app";

export const COPILOTKIT_MCP_APP_TAG = "copilotkit-mcp-app" as const;
