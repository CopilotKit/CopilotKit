import {
  MaybePromise,
  NonEmptyRecord,
  RuntimeMode,
  RUNTIME_MODE_SSE,
  RUNTIME_MODE_INTELLIGENCE,
} from "@copilotkit/shared";
import {
  createLicenseChecker,
  type LicenseChecker,
} from "@copilotkit/license-verifier";
import {
  type ResolvedDebugConfig,
  resolveDebugConfig,
  type DebugConfig,
} from "@copilotkit/shared";
import { AbstractAgent } from "@ag-ui/client";
import type { MCPClientConfig } from "@ag-ui/mcp-apps-middleware";
import { A2UIMiddlewareConfig } from "@ag-ui/a2ui-middleware";
import pkg from "../../../../package.json";
import type {
  BeforeRequestMiddleware,
  AfterRequestMiddleware,
} from "./middleware";
import { createLogger, type CopilotRuntimeLogger } from "../../../lib/logger";
import { TranscriptionService } from "../transcription-service/transcription-service";
import { AgentRunner } from "../runner/agent-runner";
import { InMemoryAgentRunner } from "../runner/in-memory";
import { IntelligenceAgentRunner } from "../runner/intelligence";
import { CopilotKitIntelligence } from "../intelligence-platform";

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

export interface OpenGenerativeUIOptions extends BaseCopilotRuntimeMiddlewareOptions {}

export type OpenGenerativeUIConfig = boolean | OpenGenerativeUIOptions;

interface CopilotRuntimeMiddlewares {
  /**
   * Auto-apply A2UIMiddleware to agents at run time.
   * Pass an object to enable and customise behaviour, or omit to disable.
   */
  a2ui?: BaseCopilotRuntimeMiddlewareOptions & A2UIMiddlewareConfig;
  /** Auto-apply MCPAppsMiddleware to agents at run time. */
  mcpApps?: McpAppsConfig;
  /** Auto-apply OpenGenerativeUIMiddleware to agents at run time. */
  openGenerativeUI?: OpenGenerativeUIConfig;
}

/**
 * Context passed to agent factory functions for per-request agent resolution.
 */
export interface AgentFactoryContext {
  /** The incoming HTTP request. */
  request: Request;
}

/**
 * A function that dynamically creates agents on a per-request basis.
 * Useful for multi-tenant scenarios or request-scoped agent configuration.
 */
export type AgentsFactory = (
  ctx: AgentFactoryContext,
) => MaybePromise<NonEmptyRecord<Record<string, AbstractAgent>>>;

/**
 * Agents can be provided as:
 * - A static record of agents
 * - A Promise that resolves to a record of agents
 * - A factory function that receives request context and returns agents (or a Promise of agents)
 */
export type AgentsConfig =
  | MaybePromise<NonEmptyRecord<Record<string, AbstractAgent>>>
  | AgentsFactory;

/**
 * Resolve an AgentsConfig value to a concrete record of agents.
 * If the config is a factory function, it is called with the given request context.
 * Otherwise it is awaited directly (static record or Promise).
 */
export async function resolveAgents(
  agents: AgentsConfig,
  request?: Request,
): Promise<Record<string, AbstractAgent>> {
  if (typeof agents === "function") {
    if (!request) {
      throw new Error(
        "Agent factory function requires a request context, but none was provided.",
      );
    }
    return agents({ request });
  }
  return agents;
}

interface BaseCopilotRuntimeOptions extends CopilotRuntimeMiddlewares {
  /**
   * Map of available agents, or a factory function for per-request agent resolution.
   *
   * Static record:
   * ```ts
   * agents: { support: new SupportAgent(), technical: new TechnicalAgent() }
   * ```
   *
   * Factory function (called per-request):
   * ```ts
   * agents: ({ request }) => {
   *   const tenantId = request.headers.get("x-tenant-id");
   *   return { default: createAgentForTenant(tenantId) };
   * }
   * ```
   */
  agents: AgentsConfig;
  /** Optional transcription service for audio processing. */
  transcriptionService?: TranscriptionService;
  /** Optional *before* middleware – callback function or webhook URL. */
  beforeRequestMiddleware?: BeforeRequestMiddleware;
  /** Optional *after* middleware – callback function or webhook URL. */
  afterRequestMiddleware?: AfterRequestMiddleware;
  /** Signed license token for server-side feature verification. Falls back to COPILOTKIT_LICENSE_TOKEN env var. */
  licenseToken?: string;
  /** Enable debug logging for the event pipeline. */
  debug?: DebugConfig;
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
  /** Max delay (ms) for WebSocket reconnect backoff. @default 10_000 */
  maxReconnectMs?: number;
  /** Max delay (ms) for channel rejoin backoff. @default 30_000 */
  maxRejoinMs?: number;
  /** Lock TTL in seconds. Clamped to a maximum of 3600 (1 hour). @default 20 */
  lockTtlSeconds?: number;
  /** Custom Redis key prefix for the thread lock. */
  lockKeyPrefix?: string;
  /** Interval in seconds at which the runtime renews the thread lock. Clamped to a maximum of 3000 (50 minutes). @default 15 */
  lockHeartbeatIntervalSeconds?: number;
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
  openGenerativeUI: CopilotRuntimeOptions["openGenerativeUI"];
  intelligence?: CopilotKitIntelligence;
  identifyUser?: IdentifyUserCallback;
  mode: RuntimeMode;
  licenseChecker?: LicenseChecker;
  debug: ResolvedDebugConfig;
  debugLogger?: CopilotRuntimeLogger;
}

export interface CopilotSseRuntimeLike extends CopilotRuntimeLike {
  intelligence?: undefined;
  mode: RUNTIME_MODE_SSE;
}

export interface CopilotIntelligenceRuntimeLike extends CopilotRuntimeLike {
  intelligence: CopilotKitIntelligence;
  identifyUser: IdentifyUserCallback;
  generateThreadNames: boolean;
  lockTtlSeconds: number;
  lockKeyPrefix?: string;
  lockHeartbeatIntervalSeconds: number;
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
  public openGenerativeUI: CopilotRuntimeOptions["openGenerativeUI"];
  public licenseChecker?: LicenseChecker;
  public debug: ResolvedDebugConfig;
  public debugLogger?: CopilotRuntimeLogger;

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
      openGenerativeUI,
    } = options;

    this.agents = agents;
    this.transcriptionService = transcriptionService;
    this.beforeRequestMiddleware = beforeRequestMiddleware;
    this.afterRequestMiddleware = afterRequestMiddleware;
    this.a2ui = a2ui || undefined;
    this.mcpApps = mcpApps;
    this.openGenerativeUI = openGenerativeUI;
    this.runner = runner;
    this.debug = resolveDebugConfig(options.debug);
    if (this.debug.enabled) {
      this.debugLogger = createLogger({
        level: "debug",
        component: "copilotkit-debug",
      });
    }
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
  readonly lockTtlSeconds: number;
  readonly lockKeyPrefix?: string;
  readonly lockHeartbeatIntervalSeconds: number;
  readonly mode = RUNTIME_MODE_INTELLIGENCE;

  /** Maximum allowed lock TTL in seconds (1 hour). */
  static readonly MAX_LOCK_TTL_SECONDS = 3_600;
  /** Maximum allowed heartbeat interval in seconds (50 minutes). */
  static readonly MAX_HEARTBEAT_INTERVAL_SECONDS = 3_000;

  constructor(options: CopilotIntelligenceRuntimeOptions) {
    super(
      options,
      new IntelligenceAgentRunner({
        url: options.intelligence.ɵgetRunnerWsUrl(),
        authToken: options.intelligence.ɵgetRunnerAuthToken(),
        maxReconnectMs: options.maxReconnectMs,
        maxRejoinMs: options.maxRejoinMs,
      }),
    );
    this.intelligence = options.intelligence;
    this.identifyUser = options.identifyUser;
    this.generateThreadNames = options.generateThreadNames ?? true;
    this.licenseChecker = createLicenseChecker(options.licenseToken);
    this.lockTtlSeconds = Math.min(
      options.lockTtlSeconds ?? 20,
      CopilotIntelligenceRuntime.MAX_LOCK_TTL_SECONDS,
    );
    this.lockKeyPrefix = options.lockKeyPrefix;
    this.lockHeartbeatIntervalSeconds = Math.min(
      options.lockHeartbeatIntervalSeconds ?? 15,
      CopilotIntelligenceRuntime.MAX_HEARTBEAT_INTERVAL_SECONDS,
    );
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

  get openGenerativeUI(): CopilotRuntimeOptions["openGenerativeUI"] {
    return this.delegate.openGenerativeUI;
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

  get lockTtlSeconds(): number | undefined {
    return isIntelligenceRuntime(this.delegate)
      ? this.delegate.lockTtlSeconds
      : undefined;
  }

  get lockKeyPrefix(): string | undefined {
    return isIntelligenceRuntime(this.delegate)
      ? this.delegate.lockKeyPrefix
      : undefined;
  }

  get lockHeartbeatIntervalSeconds(): number | undefined {
    return isIntelligenceRuntime(this.delegate)
      ? this.delegate.lockHeartbeatIntervalSeconds
      : undefined;
  }

  get mode(): RuntimeMode {
    return this.delegate.mode;
  }

  get licenseChecker() {
    return this.delegate.licenseChecker;
  }

  get debug(): ResolvedDebugConfig {
    return this.delegate.debug;
  }

  get debugLogger(): CopilotRuntimeLogger | undefined {
    return this.delegate.debugLogger;
  }
}
