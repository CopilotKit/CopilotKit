import {
  InjectionToken,
  makeEnvironmentProviders,
  type EnvironmentProviders,
} from "@angular/core";
import type {
  McpUiHostCapabilities,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";

/**
 * Maps the server id referenced by `mcp-apps` snapshots to the URL of the
 * MCP server's streamable HTTP endpoint. A function value is resolved once
 * per widget, so URLs can depend on runtime configuration.
 */
export type MCPAppsServerUrls = Record<string, string | (() => string)>;

/** Configuration for rendering MCP Apps. */
export interface MCPAppsConfig {
  servers: MCPAppsServerUrls;
  hostInfo: Implementation;
  hostCapabilities?: McpUiHostCapabilities;
  hostContext?: McpUiHostContext;
}

/** Holds the MCP Apps configuration registered via `provideMCPApps`. */
export const MCP_APPS_CONFIG = new InjectionToken<MCPAppsConfig>(
  "MCP_APPS_CONFIG",
);

/**
 * Registers the MCP Apps configuration: the MCP servers the host may connect
 * to and the host identity, capabilities, and context announced to embedded
 * apps. Required by `CopilotMCPAppsActivityRenderer`.
 */
export function provideMCPApps(config: MCPAppsConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: MCP_APPS_CONFIG,
      useValue: config,
    },
  ]);
}
