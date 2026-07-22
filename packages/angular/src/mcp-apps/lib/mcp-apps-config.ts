import { InjectionToken } from "@angular/core";

export interface MCPAppsHostInfo {
  name: string;
  version: string;
}

export interface MCPAppsConfig {
  /** Maximum time to wait for a busy agent before a queued request fails. */
  idleTimeoutMs?: number;
  /** Maximum time to wait for the sandbox proxy initialization handshake. */
  initializationTimeoutMs?: number;
  /**
   * Optional URL for a dedicated sandbox proxy document.
   *
   * Use this when the host sends a strict response-level CSP. The document
   * must implement the CopilotKit MCP sandbox proxy protocol and be served
   * with an opaque response sandbox that omits `allow-same-origin`.
   */
  sandboxProxyUrl?: string;
  /** Host identity announced during the MCP Apps initialization handshake. */
  hostInfo?: MCPAppsHostInfo;
  /** Additional protocol capabilities announced to embedded MCP Apps. */
  hostCapabilities?: Record<string, unknown>;
  /** Additional non-secret UI context announced to embedded MCP Apps. */
  hostContext?: Record<string, unknown>;
}

export const DEFAULT_MCP_APPS_CONFIG: Readonly<Required<MCPAppsConfig>> = {
  idleTimeoutMs: 30_000,
  initializationTimeoutMs: 30_000,
  sandboxProxyUrl: "",
  hostInfo: {
    name: "CopilotKit MCP Apps Host",
    version: "1.0.0",
  },
  hostCapabilities: {
    openLinks: {},
    serverTools: {},
    logging: {},
  },
  hostContext: {
    theme: "light",
    platform: "web",
  },
};

/** Holds renderer behavior configuration registered via `provideMCPApps`. */
export const MCP_APPS_CONFIG = new InjectionToken<Required<MCPAppsConfig>>(
  "MCP_APPS_CONFIG",
  { factory: () => ({ ...DEFAULT_MCP_APPS_CONFIG }) },
);
