import {
  MaybePromise,
  NonEmptyRecord,
  RuntimeMode,
} from "@copilotkitnext/shared";
import { AbstractAgent } from "@ag-ui/client";
import type { MCPClientConfig } from "@ag-ui/mcp-apps-middleware";
import { A2UIMiddlewareConfig } from "@ag-ui/a2ui-middleware";
import pkg from "../package.json";
import type {
  BeforeRequestMiddleware,
  AfterRequestMiddleware,
} from "./middleware";
import { TranscriptionService } from "./transcription-service/transcription-service";
import { AgentRunner } from "./runner/agent-runner";
import { InMemoryAgentRunner } from "./runner/in-memory";
import { IntelligenceAgentRunner } from "./runner/intelligence";
import { CopilotIntelligenceSdk } from "./intelligence-platform";

export const VERSION = pkg.version;

interface BaseCopilotRuntimeMiddlewareOptions {
  /** If set, middleware only applies to these named agents. Applies to all agents if omitted. */
  agents?: string[];
}

export type McpAppsServerConfig = MCPClientConfig & {
  /** Agent to bind this server to. If omitted, the server is available to all agents. */
  agentId?: string;
};

export interface McpAppsConfig {
  /** List of MCP server configurations. */
  servers: McpAppsServerConfig[];
}

interface CopilotRuntimeMiddlewares {
  /** Auto-apply A2UIMiddleware to agents at run time. */
  a2ui?: BaseCopilotRuntimeMiddlewareOptions & A2UIMiddlewareConfig;
  /** Auto-apply MCPAppsMiddleware to agents at run time. */
  mcpApps?: McpAppsConfig;
}

/**
 * Options used to construct a `CopilotRuntime` instance.
 */
interface BaseCopilotRuntimeOptions extends CopilotRuntimeMiddlewares {
  /** Map of available agents (loaded lazily is fine). */
  agents: MaybePromise<NonEmptyRecord<Record<string, AbstractAgent>>>;
  /** Optional transcription service for audio processing. */
  transcriptionService?: TranscriptionService;
  /** Optional *before* middleware – callback function or webhook URL. */
  beforeRequestMiddleware?: BeforeRequestMiddleware;
  /** Optional *after* middleware – callback function or webhook URL. */
  afterRequestMiddleware?: AfterRequestMiddleware;
}

export interface SseCopilotRuntimeOptions extends BaseCopilotRuntimeOptions {
  /** The runner to use for running agents in SSE mode. */
  runner?: AgentRunner;
  intelligenceSdk?: undefined;
}

export interface IntelligenceCopilotRuntimeOptions
  extends BaseCopilotRuntimeOptions {
  /** Configures Intelligence mode for durable threads and realtime events. */
  intelligenceSdk: CopilotIntelligenceSdk;
}

export type CopilotRuntimeOptions =
  | SseCopilotRuntimeOptions
  | IntelligenceCopilotRuntimeOptions;

/**
 * Central runtime object passed to all request handlers.
 */
export class CopilotRuntime {
  public agents: CopilotRuntimeOptions["agents"];
  public transcriptionService: CopilotRuntimeOptions["transcriptionService"];
  public beforeRequestMiddleware: CopilotRuntimeOptions["beforeRequestMiddleware"];
  public afterRequestMiddleware: CopilotRuntimeOptions["afterRequestMiddleware"];
  public runner: AgentRunner;
  public a2ui: CopilotRuntimeOptions["a2ui"];
  public mcpApps: CopilotRuntimeOptions["mcpApps"];
  public intelligenceSdk?: CopilotIntelligenceSdk;
  public mode: RuntimeMode;

  constructor(options: CopilotRuntimeOptions) {
    const {
      agents,
      transcriptionService,
      beforeRequestMiddleware,
      afterRequestMiddleware,
      a2ui,
      mcpApps,
    } = options;
    this.agents = agents;
    this.transcriptionService = transcriptionService;
    this.beforeRequestMiddleware = beforeRequestMiddleware;
    this.afterRequestMiddleware = afterRequestMiddleware;
    this.a2ui = a2ui;
    this.mcpApps = mcpApps;
    this.mode =
      "intelligenceSdk" in options && options.intelligenceSdk
        ? "intelligence"
        : "sse";
    this.intelligenceSdk =
      "intelligenceSdk" in options ? options.intelligenceSdk : undefined;
    this.runner =
      this.mode === "intelligence" && this.intelligenceSdk
        ? new IntelligenceAgentRunner({
            url: this.intelligenceSdk.getRunnerWsUrl(),
            authToken: this.intelligenceSdk.getRunnerAuthToken(),
          })
        : ("runner" in options && options.runner) ?? new InMemoryAgentRunner();
  }

  get isIntelligenceMode(): boolean {
    return this.mode === "intelligence";
  }
}
