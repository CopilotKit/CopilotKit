import type { Provider } from "@angular/core";
import type { MCPAppsConfig } from "@copilotkit/angular/mcp-apps";
import {
  DEFAULT_MCP_APPS_CONFIG,
  MCP_APPS_CONFIG,
} from "@copilotkit/angular/mcp-apps";

const SHOWCASE_MCP_APPS_CONFIG = {
  ...DEFAULT_MCP_APPS_CONFIG,
} satisfies Required<MCPAppsConfig>;

/** Configures MCP Apps inside lazy feature trees. */
export const SHOWCASE_MCP_APPS_PROVIDER: Provider = {
  provide: MCP_APPS_CONFIG,
  useValue: SHOWCASE_MCP_APPS_CONFIG,
};
