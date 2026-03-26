import {
  MaybePromise,
  NonEmptyRecord,
  RuntimeMode,
  RUNTIME_MODE_SSE,
  RUNTIME_MODE_INTELLIGENCE,
  createLicenseChecker,
  type LicenseChecker,
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
import { CopilotKitIntelligence } from "./intelligence-platform";

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
  /** Signed license token for server-side feature verification. Falls back to COPILOTKIT_LICENSE_TOKEN env var. */
  licenseToken?: string;
}

export interface CopilotRuntimeUser {
  id: string;
}

export type IdentifyUserCallback = (
  request: Request,
) => MaybePromise<CopilotRuntimeUser>;

export interface CopilotSseRuntimeOptions extends BaseCopilotRuntimeOptions {
  /** The runner to use for running agents in SSE mode. */
  runner?: AgentRunner;
  intelligence?: undefined;
  generateThreadNames?: undefined;
}

export interface CopilotIntelligenceRuntimeOptions extends BaseCopilotRuntimeOptions {
  /** Configures Intelligence mode for durable threads and realtime events. */
  intelligence: CopilotKitIntelligence;
  /** Resolves the authenticated user for intelligence requests. */
  identifyUser: IdentifyUserCallback;
  /** Auto-generate short names for newly created threads. */
  generateThreadNames?: boolean;
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
  intelligence?: CopilotKitIntelligence;
  identifyUser?: IdentifyUserCallback;
  mode: RuntimeMode;
  licenseChecker?: LicenseChecker;
}

export interface CopilotSseRuntimeLike extends CopilotRuntimeLike {
  intelligence?: undefined;
  mode: RUNTIME_MODE_SSE;
}

export interface CopilotIntelligenceRuntimeLike extends CopilotRuntimeLike {
  intelligence: CopilotKitIntelligence;
  identifyUser: IdentifyUserCallback;
  generateThreadNames: boolean;
  mode: RUNTIME_MODE_INTELLIGENCE;
}

abstract class BaseCopilotRuntime implements CopilotRuntimeLike {
  public agents: CopilotRuntimeOptions["agents"];
  public transcriptionService: CopilotRuntimeOptions["transcriptionService"];
  public beforeRequestMiddleware: CopilotRuntimeOptions["beforeRequestMiddleware"];
  public afterRequestMiddleware: CopilotRuntimeOptions["afterRequestMiddleware"];
  public runner: AgentRunner;
  public a2ui: CopilotRuntimeOptions["a2ui"];
  public mcpApps: CopilotRuntimeOptions["mcpApps"];
  public licenseChecker?: LicenseChecker;

  abstract readonly intelligence?: CopilotKitIntelligence;
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
    this.licenseChecker = createLicenseChecker(options.licenseToken);
  }
}

export class CopilotSseRuntime
  extends BaseCopilotRuntime
  implements CopilotSseRuntimeLike
{
  readonly intelligence = undefined;
  readonly mode = RUNTIME_MODE_SSE;

  constructor(options: CopilotSseRuntimeOptions) {
    super(options, options.runner ?? new InMemoryAgentRunner());
  }
}

export class CopilotIntelligenceRuntime
  extends BaseCopilotRuntime
  implements CopilotIntelligenceRuntimeLike
{
  readonly intelligence: CopilotKitIntelligence;
  readonly identifyUser: IdentifyUserCallback;
  readonly generateThreadNames: boolean;
  readonly mode = RUNTIME_MODE_INTELLIGENCE;

  constructor(options: CopilotIntelligenceRuntimeOptions) {
    super(
      options,
      new IntelligenceAgentRunner({
        url: options.intelligence.ɵgetRunnerWsUrl(),
        authToken: options.intelligence.ɵgetRunnerAuthToken(),
      }),
    );
    this.intelligence = options.intelligence;
    this.identifyUser = options.identifyUser;
    this.generateThreadNames = options.generateThreadNames ?? true;
  }
}

function hasIntelligenceOptions(
  options: CopilotRuntimeOptions,
): options is CopilotIntelligenceRuntimeOptions {
  return "intelligence" in options && !!options.intelligence;
}

export function isIntelligenceRuntime(
  runtime: CopilotRuntimeLike,
): runtime is CopilotIntelligenceRuntimeLike {
  return runtime.mode === RUNTIME_MODE_INTELLIGENCE && !!runtime.intelligence;
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

  get intelligence(): CopilotKitIntelligence | undefined {
    return this.delegate.intelligence;
  }

  get generateThreadNames(): boolean | undefined {
    return isIntelligenceRuntime(this.delegate)
      ? this.delegate.generateThreadNames
      : undefined;
  }

  get identifyUser(): IdentifyUserCallback | undefined {
    return isIntelligenceRuntime(this.delegate)
      ? this.delegate.identifyUser
      : undefined;
  }

  get mode(): RuntimeMode {
    return this.delegate.mode;
  }

  get licenseChecker() {
    return this.delegate.licenseChecker;
  }
}
