// Side-effecting entry: registers `<copilotkit-mcp-app>` with the custom
// element registry. Import for the effect; call `defineMcpAppWebComponents()`
// explicitly if you prefer an idempotent, guarded registration.
import { CopilotKitMcpApp } from "./mcp-app";
import { COPILOTKIT_MCP_APP_TAG } from "./index";

export function defineMcpAppWebComponents(): void {
  if (
    typeof customElements !== "undefined" &&
    !customElements.get(COPILOTKIT_MCP_APP_TAG)
  ) {
    customElements.define(COPILOTKIT_MCP_APP_TAG, CopilotKitMcpApp);
  }
}

defineMcpAppWebComponents();

export { CopilotKitMcpApp, COPILOTKIT_MCP_APP_TAG };
