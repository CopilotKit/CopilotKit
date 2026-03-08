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

export interface CopilotSseRuntimeOptions extends BaseCopilotRuntimeOptions {
  /** The runner to use for running agents in SSE mode. */
  runner?: AgentRunner;
  intelligenceSdk?: undefined;
}

export interface CopilotIntelligenceRuntimeOptions
  extends BaseCopilotRuntimeOptions {
  /** Configures Intelligence mode for durable threads and realtime events. */
  intelligenceSdk: CopilotIntelligenceSdk;
}

export type CopilotRuntimeOptions =
  | CopilotSseRuntimeOptions
  | CopilotIntelligenceRuntimeOptions;

export interface CopilotRuntimeLike {
  agents: CopilotRuntimeOptions["agents"];
  transcriptionService: CopilotRuntimeOptions["transcriptionService"];
  beforeRequestMiddleware: CopilotRuntimeOptions["beforeRequestMiddleware"];
  afterRequestMiddleware: CopilotRuntimeOptions["afterRequestMiddleware"];
  runner: AgentRunner;
  a2ui: CopilotRuntimeOptions["a2ui"];
  mcpApps: CopilotRuntimeOptions["mcpApps"];
  intelligenceSdk?: CopilotIntelligenceSdk;
  mode: RuntimeMode;
  readonly isIntelligenceMode: boolean;
}

export interface CopilotSseRuntimeLike extends CopilotRuntimeLike {
  intelligenceSdk?: undefined;
  isIntelligenceMode: false;
  mode: "sse";
}

export interface CopilotIntelligenceRuntimeLike extends CopilotRuntimeLike {
  intelligenceSdk: CopilotIntelligenceSdk;
  isIntelligenceMode: true;
  mode: "intelligence";
}

abstract class BaseCopilotRuntime implements CopilotRuntimeLike {
  public agents: CopilotRuntimeOptions["agents"];
  public transcriptionService: CopilotRuntimeOptions["transcriptionService"];
  public beforeRequestMiddleware: CopilotRuntimeOptions["beforeRequestMiddleware"];
  public afterRequestMiddleware: CopilotRuntimeOptions["afterRequestMiddleware"];
  public runner: AgentRunner;
  public a2ui: CopilotRuntimeOptions["a2ui"];
  public mcpApps: CopilotRuntimeOptions["mcpApps"];

  abstract readonly intelligenceSdk?: CopilotIntelligenceSdk;
  abstract readonly mode: RuntimeMode;

  constructor(options: BaseCopilotRuntimeOptions, runner: AgentRunner) {
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
    this.runner = runner;
  }

  get isIntelligenceMode(): boolean {
    return this.mode === "intelligence";
  }
}

export class CopilotSseRuntime
  extends BaseCopilotRuntime
  implements CopilotSseRuntimeLike
{
  readonly intelligenceSdk = undefined;
  readonly mode = "sse" as const;

  constructor(options: CopilotSseRuntimeOptions) {
    super(options, options.runner ?? new InMemoryAgentRunner());
  }
}

export class CopilotIntelligenceRuntime
  extends BaseCopilotRuntime
  implements CopilotIntelligenceRuntimeLike
{
  readonly intelligenceSdk: CopilotIntelligenceSdk;
  readonly mode = "intelligence" as const;

  constructor(options: CopilotIntelligenceRuntimeOptions) {
    super(
      options,
      new IntelligenceAgentRunner({
        url: options.intelligenceSdk.getRunnerWsUrl(),
        authToken: options.intelligenceSdk.getRunnerAuthToken(),
      }),
    );
    this.intelligenceSdk = options.intelligenceSdk;
  }
}

function hasIntelligenceOptions(
  options: CopilotRuntimeOptions,
): options is CopilotIntelligenceRuntimeOptions {
  return "intelligenceSdk" in options && !!options.intelligenceSdk;
}

export function isIntelligenceRuntime(
  runtime: CopilotRuntimeLike,
): runtime is CopilotIntelligenceRuntimeLike {
  return runtime.mode === "intelligence" && !!runtime.intelligenceSdk;
}

/**
 * Compatibility shim that preserves the legacy `CopilotRuntime` entrypoint.
 * New code should prefer `CopilotSseRuntime` or `CopilotIntelligenceRuntime`.
 */
export class CopilotRuntime implements CopilotRuntimeLike {
  private delegate: CopilotRuntimeLike;

  constructor(options: CopilotRuntimeOptions) {
    this.delegate = hasIntelligenceOptions(options)
      ? new CopilotIntelligenceRuntime(options)
      : new CopilotSseRuntime(options);
  }

  get agents(): CopilotRuntimeOptions["agents"] {
    return this.delegate.agents;
  }

  get transcriptionService(): CopilotRuntimeOptions["transcriptionService"] {
    return this.delegate.transcriptionService;
  }

  get beforeRequestMiddleware(): CopilotRuntimeOptions["beforeRequestMiddleware"] {
    return this.delegate.beforeRequestMiddleware;
  }

  get afterRequestMiddleware(): CopilotRuntimeOptions["afterRequestMiddleware"] {
    return this.delegate.afterRequestMiddleware;
  }

  get runner(): AgentRunner {
    return this.delegate.runner;
  }

  get a2ui(): CopilotRuntimeOptions["a2ui"] {
    return this.delegate.a2ui;
  }

  get mcpApps(): CopilotRuntimeOptions["mcpApps"] {
    return this.delegate.mcpApps;
  }

  get intelligenceSdk(): CopilotIntelligenceSdk | undefined {
    return this.delegate.intelligenceSdk;
  }

  get mode(): RuntimeMode {
    return this.delegate.mode;
  }

  get isIntelligenceMode(): boolean {
    return this.delegate.isIntelligenceMode;
  }
}
