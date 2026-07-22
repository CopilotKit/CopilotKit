import type { Provider } from "@angular/core";
import type { MCPAppsConfig } from "@copilotkit/angular/mcp-apps";
import {
  DEFAULT_MCP_APPS_CONFIG,
  MCP_APPS_CONFIG,
} from "@copilotkit/angular/mcp-apps";

const SHOWCASE_MCP_APPS_CONFIG = {
  ...DEFAULT_MCP_APPS_CONFIG,
  sandboxProxyUrl: "/mcp-apps-sandbox.html",
} satisfies Required<MCPAppsConfig>;

/** Configures the strict-CSP sandbox document inside lazy MCP feature trees. */
export const SHOWCASE_MCP_APPS_PROVIDER: Provider = {
  provide: MCP_APPS_CONFIG,
  useValue: SHOWCASE_MCP_APPS_CONFIG,
};
