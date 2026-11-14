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
  /** Host identity announced during the MCP Apps initialization handshake. */
  hostInfo?: MCPAppsHostInfo;
  /** Additional protocol capabilities announced to embedded MCP Apps. */
  hostCapabilities?: Record<string, unknown>;
  /** Additional non-secret UI context announced to embedded MCP Apps. */
  hostContext?: Record<string, unknown>;
  /**
   * Restore `allow-same-origin` on the MCP App sandbox. Default `false`.
   *
   * **Unsafe.** The widget then runs with your page's origin: it can read
   * your cookies, storage and DOM, and call your APIs as the signed-in user.
   * Only set it for widgets you wrote and trust that need `localStorage`,
   * `IndexedDB` or cookies. By default widgets get an opaque origin.
   */
  allowSameOriginFallback?: boolean;
}

export const DEFAULT_MCP_APPS_CONFIG: Readonly<Required<MCPAppsConfig>> = {
  idleTimeoutMs: 30_000,
  initializationTimeoutMs: 30_000,
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
    platform: "web",
  },
  allowSameOriginFallback: false,
};

/** Holds renderer behavior configuration registered via `provideMCPApps`. */
export const MCP_APPS_CONFIG = new InjectionToken<Required<MCPAppsConfig>>(
  "MCP_APPS_CONFIG",
  { factory: () => ({ ...DEFAULT_MCP_APPS_CONFIG }) },
);
