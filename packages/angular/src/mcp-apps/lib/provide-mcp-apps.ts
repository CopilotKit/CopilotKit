import {
  makeEnvironmentProviders,
  type EnvironmentProviders,
} from "@angular/core";
import { ɵCOPILOTKIT_BUILT_IN_ACTIVITY_RENDERERS } from "@copilotkit/angular";
import { mcpAppsActivityRendererConfig } from "./mcp-apps-activity-renderer";
import {
  DEFAULT_MCP_APPS_CONFIG,
  MCP_APPS_CONFIG,
  type MCPAppsConfig,
  type MCPAppsHostInfo,
} from "./mcp-apps-config";

export type { MCPAppsConfig, MCPAppsHostInfo } from "./mcp-apps-config";
export { DEFAULT_MCP_APPS_CONFIG, MCP_APPS_CONFIG } from "./mcp-apps-config";

/**
 * Configures and registers the built-in MCP Apps renderer.
 *
 * MCP resource and tool requests always travel through the selected AG-UI
 * agent. Server URLs deliberately are not accepted by this browser provider.
 * Application renderers retain precedence over this built-in registration.
 */
export function provideMCPApps(
  config: MCPAppsConfig = {},
): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: MCP_APPS_CONFIG,
      useValue: {
        ...DEFAULT_MCP_APPS_CONFIG,
        ...config,
        hostInfo: {
          ...DEFAULT_MCP_APPS_CONFIG.hostInfo,
          ...config.hostInfo,
        },
        hostCapabilities: {
          ...DEFAULT_MCP_APPS_CONFIG.hostCapabilities,
          ...config.hostCapabilities,
        },
        hostContext: {
          ...DEFAULT_MCP_APPS_CONFIG.hostContext,
          ...config.hostContext,
        },
      } satisfies Required<MCPAppsConfig>,
    },
    {
      provide: ɵCOPILOTKIT_BUILT_IN_ACTIVITY_RENDERERS,
      multi: true,
      useValue: mcpAppsActivityRendererConfig,
    },
  ]);
}
