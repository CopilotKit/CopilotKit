import type { McpServerConfig } from "./config";
import { connectMcpServer } from "./connect";
import type { ConnectedMcpClient, McpConnect } from "./connect";
import type { MCPClientProvider } from "@copilotkit/runtime/v2";

// `MCPClientProvider` is `{ tools(): Promise<ToolSet> }`. We derive `ToolSet`
// locally from that signature rather than importing it from "ai": `ai` is a
// transitive dependency that is NOT resolvable from this app and importing it
// fails with MODULE_NOT_FOUND.
type ToolSet = Awaited<ReturnType<MCPClientProvider["tools"]>>;

export type McpStatus = "disabled" | "connecting" | "ready" | "error";

export interface McpServerStatus {
  name: string;
  kind: "stdio" | "remote";
  enabled: boolean;
  status: McpStatus;
  toolNames: string[];
  logs: string[];
}

const MAX_LOGS = 20;

/**
 * Mutable per-server state held by the manager. The {@link MCPClientProvider}
 * closure reads this object LIVE at `tools()` call time, so toggling `enabled`
 * or swapping `client` takes effect immediately without rebuilding providers.
 */
interface ServerState {
  config: McpServerConfig;
  name: string;
  kind: "stdio" | "remote";
  enabled: boolean;
  status: McpStatus;
  client: ConnectedMcpClient | null;
  toolNames: string[];
  logs: string[];
  /** Stable provider ref — same identity across calls and toggles. */
  provider: MCPClientProvider;
}

export class McpManager {
  private readonly states: ServerState[];
  private readonly connect: McpConnect;

  constructor(
    configs: McpServerConfig[],
    connect: McpConnect = connectMcpServer,
  ) {
    this.connect = connect;
    this.states = configs.map((config) => {
      // A config may opt to start disabled via an `enabled: false` field;
      // otherwise servers default to enabled.
      const enabled = config.enabled !== false;

      const state: ServerState = {
        config,
        name: config.name,
        kind: config.kind,
        enabled,
        // All servers start in "disabled" until connectAll() promotes the
        // enabled ones to "connecting"/"ready"; servers that start disabled
        // remain here.
        status: "disabled",
        client: null,
        toolNames: [],
        logs: [],
        // Stable closure reading LIVE state.
        provider: {
          tools: async (): Promise<ToolSet> => {
            if (!state.enabled || !state.client) {
              return {} as ToolSet;
            }
            // `BuiltInAgent` awaits this on EVERY run. A server can drop after
            // initial connect (session expired / child died), so a rejection
            // here must NOT abort the whole chat turn — degrade to "no tools
            // from this server" instead.
            try {
              return (await state.client.tools()) as ToolSet;
            } catch (err: unknown) {
              state.status = "error";
              const message = err instanceof Error ? err.message : String(err);
              this.pushLog(state, `tools() failed: ${message}`);
              return {} as ToolSet;
            }
          },
        },
      };
      return state;
    });
  }

  /**
   * Connect every enabled server in parallel. Per-server errors are captured
   * into `status: "error"` plus a log line; this method NEVER throws. A server
   * that starts disabled is left untouched (`status: "disabled"`, not
   * connected).
   */
  async connectAll(): Promise<void> {
    await Promise.all(
      this.states.map(async (state) => {
        if (!state.enabled) {
          state.status = "disabled";
          return;
        }
        state.status = "connecting";
        try {
          const client = await this.connect(state.config);
          state.client = client;
          const tools = await client.tools();
          state.toolNames = Object.keys(tools);
          state.status = "ready";
          this.pushLog(
            state,
            `connected (${state.toolNames.length} tool${state.toolNames.length === 1 ? "" : "s"})`,
          );
        } catch (err: unknown) {
          state.status = "error";
          const message = err instanceof Error ? err.message : String(err);
          this.pushLog(state, `error: ${message}`);
        }
      }),
    );
  }

  /**
   * Return the STABLE provider refs (same array of objects across calls and
   * across `setEnabled` toggles).
   */
  getProviders(): MCPClientProvider[] {
    return this.states.map((state) => state.provider);
  }

  /**
   * Flip a server's `enabled` flag. Turning off sets `status: "disabled"`;
   * turning on restores the status implied by the current client (`ready` when
   * a client exists, else `disabled`). The provider closure already returns
   * `{}` tools whenever the server is disabled, so no provider swap is needed.
   */
  setEnabled(name: string, enabled: boolean): void {
    const state = this.states.find((s) => s.name === name);
    if (!state) return;
    state.enabled = enabled;
    if (!enabled) {
      state.status = "disabled";
    } else {
      state.status = state.client ? "ready" : "disabled";
    }
  }

  /** Snapshot the current status of every server. */
  getStatuses(): McpServerStatus[] {
    return this.states.map((state) => ({
      name: state.name,
      kind: state.kind,
      enabled: state.enabled,
      status: state.status,
      toolNames: [...state.toolNames],
      logs: [...state.logs],
    }));
  }

  /** Close every connected client, swallowing per-client errors. */
  async closeAll(): Promise<void> {
    await Promise.all(
      this.states.map(async (state) => {
        try {
          await state.client?.close?.();
        } catch {
          // Swallow close errors — best effort teardown.
        }
      }),
    );
  }

  private pushLog(state: ServerState, line: string): void {
    state.logs.push(line);
    if (state.logs.length > MAX_LOGS) {
      state.logs.splice(0, state.logs.length - MAX_LOGS);
    }
  }
}
