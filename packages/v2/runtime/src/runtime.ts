import { MaybePromise, NonEmptyRecord } from "@copilotkitnext/shared";
import { AbstractAgent } from "@ag-ui/client";
import { MCPAppsMiddlewareConfig } from "@ag-ui/mcp-apps-middleware";
import { A2UIMiddlewareConfig } from "@ag-ui/a2ui-middleware";
import pkg from "../package.json";
import type {
  BeforeRequestMiddleware,
  AfterRequestMiddleware,
} from "./middleware";
import { TranscriptionService } from "./transcription-service/transcription-service";
import { AgentRunner } from "./runner/agent-runner";
import { InMemoryAgentRunner } from "./runner/in-memory";

export const VERSION = pkg.version;

interface BaseCopilotRuntimeMiddlewareOptions {
  /** If set, middleware only applies to these named agents. Applies to all agents if omitted. */
  agents?: string[];
}

interface CopilotRuntimeMiddlewares {
  /** Auto-apply A2UIMiddleware to agents at run time. */
  a2ui?: BaseCopilotRuntimeMiddlewareOptions & A2UIMiddlewareConfig;
  /** Auto-apply MCPAppsMiddleware to agents at run time. */
  mcp?: BaseCopilotRuntimeMiddlewareOptions & MCPAppsMiddlewareConfig;
}

/**
 * Options used to construct a `CopilotRuntime` instance.
 */
export interface CopilotRuntimeOptions extends CopilotRuntimeMiddlewares {
  /** Map of available agents (loaded lazily is fine). */
  agents: MaybePromise<NonEmptyRecord<Record<string, AbstractAgent>>>;
  /** The runner to use for running agents. */
  runner?: AgentRunner;
  /** Optional transcription service for audio processing. */
  transcriptionService?: TranscriptionService;
  /** Optional *before* middleware – callback function or webhook URL. */
  beforeRequestMiddleware?: BeforeRequestMiddleware;
  /** Optional *after* middleware – callback function or webhook URL. */
  afterRequestMiddleware?: AfterRequestMiddleware;
}

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
  public mcp: CopilotRuntimeOptions["mcp"];

  constructor({
    agents,
    transcriptionService,
    beforeRequestMiddleware,
    afterRequestMiddleware,
    runner,
    a2ui,
    mcp,
  }: CopilotRuntimeOptions) {
    this.agents = agents;
    this.transcriptionService = transcriptionService;
    this.beforeRequestMiddleware = beforeRequestMiddleware;
    this.afterRequestMiddleware = afterRequestMiddleware;
    this.runner = runner ?? new InMemoryAgentRunner();
    this.a2ui = a2ui;
    this.mcp = mcp;
  }
}
