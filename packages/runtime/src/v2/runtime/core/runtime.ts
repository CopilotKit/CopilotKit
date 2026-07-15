import type {
  MaybePromise,
  NonEmptyRecord,
  RuntimeMode,
} from "@copilotkit/shared";
import {
  RUNTIME_MODE_SSE,
  RUNTIME_MODE_INTELLIGENCE,
} from "@copilotkit/shared";
import { createLicenseChecker } from "@copilotkit/license-verifier";
import type { LicenseChecker } from "@copilotkit/license-verifier";
import { resolveDebugConfig } from "@copilotkit/shared";
import type { ResolvedDebugConfig, DebugConfig } from "@copilotkit/shared";
import { resolveForwardHeadersPolicy } from "../handlers/header-utils";
import type {
  ForwardHeadersConfig,
  ResolvedForwardHeadersPolicy,
} from "../handlers/header-utils";
import type { AbstractAgent } from "@ag-ui/client";
import type { MCPClientConfig } from "@ag-ui/mcp-apps-middleware";
import type { A2UIMiddlewareConfig } from "@ag-ui/a2ui-middleware";
import pkg from "../../../../package.json";
import type {
  BeforeRequestMiddleware,
  AfterRequestMiddleware,
} from "./middleware";
import { createLogger } from "../../../lib/logger";
import type { CopilotRuntimeLogger } from "../../../lib/logger";
import { logRuntimeTelemetryDisclosure } from "../../../lib/telemetry-disclosure";
import type { TranscriptionService } from "../transcription-service/transcription-service";
import { DebugEventBus } from "./debug-event-bus";
import type { AgentRunner } from "../runner/agent-runner";
import { InMemoryAgentRunner } from "../runner/in-memory";
import { IntelligenceAgentRunner } from "../runner/intelligence";
import type { CopilotKitIntelligence } from "../intelligence-platform";
// Type-only: @copilotkit/channels is pure-ESM, so a value import would break this
// package's CJS output. The channels are validated + activated (wired to delivery
// transports) by `startChannels` from @copilotkit/channels-intelligence, called
// by the Channel-listener bootstrap — not here.
import type { Channel } from "@copilotkit/channels";
import telemetry from "../telemetry/telemetry-client";

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
  a2ui?: BaseCopilotRuntimeMiddlewareOptions &
    A2UIMiddlewareConfig & {
      /**
       * Explicit on/off switch. Omit (or set `true`) to enable; set `false`
       * to disable A2UI for this runtime while keeping the rest of the config
       * (e.g. a `schema`/`catalog`) in place. A bare `a2ui: {}` stays enabled
       * for backwards compatibility.
       */
      enabled?: boolean;
    };
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
  /**
   * Policy controlling which inbound HTTP headers are forwarded onto the
   * outgoing agent call. By default a built-in denylist strips known
   * infrastructure/proxy/platform headers (`x-forwarded-*`, `x-real-ip`,
   * `x-vercel-*`, `x-copilotcloud-*`, etc.) while `authorization` and custom
   * `x-*` application headers continue to forward (#5712). Set
   * `{ useDefaultDenylist: false }` to restore the previous wide-open behavior.
   */
  forwardHeaders?: ForwardHeadersConfig;
  /**
   * Opt-in flag exposing the client-facing memory proxy routes
   * (`/memories`, `/memories/recall`, `/memories/subscribe`, `/memories/:id`).
   *
   * Defaults to `false` — a **secure default**. When off, every `/memories/*`
   * request 404s as if the route did not exist, so an un-opted-in deployment
   * reveals nothing about memory even when Intelligence is configured. This does
   * NOT affect the agent's own server-side memory tooling (`recall_memory` runs
   * via the Intelligence MCP path, separate from this client REST proxy).
   *
   * Flip to `true` to power a client memory inspector (e.g. the dev console's
   * Memory tab). Existing Intelligence deployments relying on the previously
   * always-on Learning tab must set this to restore it.
   */
  exposeMemoryRoutes?: boolean;
}

export interface CopilotRuntimeUser {
  id: string;
  name: string;
}

export type IdentifyUserCallback = (
  request: Request,
) => MaybePromise<CopilotRuntimeUser>;

export interface CopilotSseRuntimeOptions extends BaseCopilotRuntimeOptions {
  /** The runner to use for running agents in SSE mode. */
  runner?: AgentRunner;
  intelligence?: undefined;
  generateThreadNames?: undefined;
  /** Intelligence Channels require the Intelligence runtime; not available in SSE mode. */
  channels?: undefined;
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
  /**
   * Intelligence Channels declared by this runtime. Each is a
   * `createChannel({ name })` instance. Only available on the Intelligence runtime
   * path. Names are validated (required, lowercase kebab-case, unique) and wired
   * to delivery/egress transports when activated via `startChannels` from
   * `@copilotkit/channels-intelligence` — not at construction.
   */
  channels?: Channel[];
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
  debugEventBus?: DebugEventBus;
  debug: ResolvedDebugConfig;
  debugLogger?: CopilotRuntimeLogger;
  /**
   * Resolved inbound-header forwarding policy read by the /run and /connect call
   * sites. Optional on the published interface so an external `CopilotRuntimeLike`
   * implementor predating this field stays source-compatible (non-breaking minor
   * release). Concrete runtimes (`BaseCopilotRuntime`) always resolve and set it;
   * the call sites coalesce a missing value to the default resolved policy
   * (`resolveForwardHeadersPolicy(undefined)` — default-on denylist).
   */
  forwardHeadersPolicy?: ResolvedForwardHeadersPolicy;
  /**
   * Resolved opt-in flag for the client-facing memory proxy routes. Optional on
   * the published interface so an external `CopilotRuntimeLike` implementor
   * predating this field stays source-compatible; the dispatcher coalesces a
   * missing value to `false` (secure default — routes hidden). Concrete runtimes
   * (`BaseCopilotRuntime`) always resolve and set it.
   */
  exposeMemoryRoutes?: boolean;
}

export interface CopilotSseRuntimeLike extends CopilotRuntimeLike {
  intelligence?: undefined;
  mode: typeof RUNTIME_MODE_SSE;
}

export interface CopilotIntelligenceRuntimeLike extends CopilotRuntimeLike {
  intelligence: CopilotKitIntelligence;
  identifyUser: IdentifyUserCallback;
  generateThreadNames: boolean;
  lockTtlSeconds: number;
  lockKeyPrefix?: string;
  lockHeartbeatIntervalSeconds: number;
  channels: Channel[];
  mode: typeof RUNTIME_MODE_INTELLIGENCE;
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
  public readonly debugEventBus?: DebugEventBus;
  public debug: ResolvedDebugConfig;
  public debugLogger?: CopilotRuntimeLogger;
  public readonly forwardHeadersPolicy: ResolvedForwardHeadersPolicy;
  public readonly exposeMemoryRoutes: boolean;

  /**
   * License token resolved once with the env fallback, so telemetry
   * attribution (below) and subclass feature gating
   * (CopilotIntelligenceRuntime's licenseChecker) read the exact same value
   * instead of each re-applying `?? COPILOTKIT_LICENSE_TOKEN`.
   */
  protected readonly resolvedLicenseToken?: string;

  abstract readonly intelligence?: CopilotKitIntelligence;
  abstract readonly mode: RuntimeMode;

  constructor(options: BaseCopilotRuntimeOptions, runner: AgentRunner) {
    logRuntimeTelemetryDisclosure();

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

    // Resolve the license token once (matching the license-verifier's env
    // fallback) so telemetry attribution and subclass feature gating share
    // one value.
    this.resolvedLicenseToken =
      options.licenseToken ?? process.env.COPILOTKIT_LICENSE_TOKEN;

    // Attribute telemetry to the licensed customer for *every* runtime mode.
    // Done in the shared base (not the subclasses) so SSE and Intelligence
    // runtimes behave identically — previously only CopilotIntelligenceRuntime
    // set this, so self-hosted SSE users never got a telemetry_id on their
    // runtime events even with a license token configured.
    if (this.resolvedLicenseToken) {
      telemetry.setLicenseToken(this.resolvedLicenseToken);
    }

    if (process.env.NODE_ENV !== "production") {
      this.debugEventBus = new DebugEventBus();
    }
    // Resolve the inbound-header forwarding policy once (mirroring the
    // `debug` → `ResolvedDebugConfig` resolve-once above) so both the /run and
    // /connect call sites read the exact same resolved policy off the runtime
    // and can never diverge.
    this.forwardHeadersPolicy = resolveForwardHeadersPolicy(
      options.forwardHeaders,
    );
    // Secure default: the client-facing memory proxy routes stay hidden (404)
    // unless a deployment explicitly opts in.
    this.exposeMemoryRoutes = options.exposeMemoryRoutes ?? false;
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
    // Runtime guard mirroring the discriminated-union type: the SSE runtime has
    // no Intelligence delivery path, so `channels` cannot be honored here. The
    // type forbids it, but a JS / `as any` caller passing `{ agents, channels }`
    // would otherwise land here and have `channels` silently dropped — fail
    // loud instead.
    const channels = (options as { channels?: unknown[] }).channels;
    if (Array.isArray(channels) && channels.length > 0) {
      throw new Error(
        "`channels` requires the Intelligence runtime (pass `intelligence`); " +
          "Intelligence Channels are not available in SSE mode.",
      );
    }
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
  readonly channels: Channel[];
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
    // Telemetry attribution is handled by the base constructor for all modes;
    // here we only need the token for feature gating. Reuse the base-resolved
    // value so gating and attribution can never disagree.
    this.licenseChecker = createLicenseChecker(this.resolvedLicenseToken);
    this.lockTtlSeconds = Math.min(
      options.lockTtlSeconds ?? 20,
      CopilotIntelligenceRuntime.MAX_LOCK_TTL_SECONDS,
    );
    this.lockKeyPrefix = options.lockKeyPrefix;
    this.lockHeartbeatIntervalSeconds = Math.min(
      options.lockHeartbeatIntervalSeconds ?? 15,
      CopilotIntelligenceRuntime.MAX_HEARTBEAT_INTERVAL_SECONDS,
    );
    // Declared Intelligence Channels. Lowercase kebab-case name-shape validation
    // (`assertValidChannelNames`) lives in the channels-intelligence launcher —
    // it can't run here because it's a value import from the pure-ESM
    // `@copilotkit/channels-intelligence`, which this CJS package must not pull in.
    // Name UNIQUENESS across declared Channels is enforced by
    // `ChannelManager.activate()`, not the launcher: the managed path activates
    // one Channel per launcher call, so the launcher never sees the full set.
    // Fail fast on the most common misconfiguration (a missing name) right here
    // at construction, though, rather than only at activation.
    this.channels = options.channels ?? [];
    for (const c of this.channels) {
      if (!c.name) {
        throw new Error(
          "Intelligence Channel is missing a `name` — pass createChannel({ name }) for each Channel in `channels`",
        );
      }
    }
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
 * Single source of truth for "is A2UI on for this runtime?". Both the run path
 * (which applies `A2UIMiddleware`) and the `/info` response (which tells the
 * client whether to mount the A2UI renderer + catalog context) MUST go through
 * this, so they can never disagree — the divergence between them was the root
 * of CopilotKit/CopilotKit#5369.
 *
 * Backwards compatible: any config object is enabled (matching the historical
 * `!!runtime.a2ui`); only an explicit `enabled: false` turns it off.
 */
export function isA2UIEnabled(
  a2ui: CopilotRuntimeOptions["a2ui"],
): a2ui is NonNullable<CopilotRuntimeOptions["a2ui"]> {
  return !!a2ui && a2ui.enabled !== false;
}

/**
 * Compile-time phantom brand marking a {@link CopilotRuntime} that was
 * constructed with at least one declared Intelligence Channel. It has no runtime
 * representation — the shim never sets this property; it exists purely so
 * `createCopilotRuntimeHandler` can tell, at the type level, that the resulting
 * handler will carry a non-optional `.channels` control surface.
 */
export interface RuntimeWithDeclaredChannels {
  /**
   * @internal Phantom brand key. Never present at runtime; do not read or set.
   */
  readonly __copilotkitChannelsDeclared: true;
}

/**
 * Instance shape of the {@link CopilotRuntime} compatibility shim. Extends
 * {@link CopilotRuntimeLike} with the Intelligence-only accessors the shim
 * surfaces (all `undefined` in SSE mode). Declared explicitly so the exported
 * `CopilotRuntime` name resolves as a type as well as a value.
 */
export interface CopilotRuntime extends CopilotRuntimeLike {
  /** Auto-generate short thread names; `undefined` in SSE mode. */
  generateThreadNames?: boolean;
  /** Thread lock TTL in seconds; `undefined` in SSE mode. */
  lockTtlSeconds?: number;
  /** Custom Redis key prefix for the thread lock; `undefined` in SSE mode. */
  lockKeyPrefix?: string;
  /** Thread lock heartbeat interval in seconds; `undefined` in SSE mode. */
  lockHeartbeatIntervalSeconds?: number;
  /** Declared Intelligence Channels; `undefined` in SSE mode. */
  channels?: Channel[];
}

/**
 * Constructor type for the {@link CopilotRuntime} compatibility shim.
 *
 * The first overload fires when the caller passes `intelligence` together with a
 * non-empty `channels` tuple: it returns a {@link RuntimeWithDeclaredChannels}-
 * branded runtime, which `createCopilotRuntimeHandler` maps to a handler whose
 * `.channels` is non-optional. Every other configuration (SSE, or Intelligence
 * without channels, or an empty `channels: []`) falls through to the second
 * overload and stays unbranded, so its handler keeps `.channels` optional.
 *
 * A class constructor cannot vary its return type across overloads (it is pinned
 * to the instance type), so the branding lives on this construct-signature
 * interface instead of on the class itself.
 */
export interface CopilotRuntimeConstructor {
  new (
    options: Omit<CopilotIntelligenceRuntimeOptions, "channels"> & {
      channels: readonly [Channel, ...Channel[]];
    },
  ): CopilotRuntime & RuntimeWithDeclaredChannels;
  new (options: CopilotRuntimeOptions): CopilotRuntime;
}

/**
 * Compatibility shim that preserves the legacy `CopilotRuntime` entrypoint.
 * New code should prefer `CopilotSseRuntime` or `CopilotIntelligenceRuntime`.
 *
 * Exported to consumers as the {@link CopilotRuntime} value (typed as
 * {@link CopilotRuntimeConstructor}) rather than as a class, so that the
 * channel-presence brand can flow from construction into the handler type.
 */
class CopilotRuntimeShim implements CopilotRuntime {
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

  get channels(): Channel[] | undefined {
    return isIntelligenceRuntime(this.delegate)
      ? this.delegate.channels
      : undefined;
  }

  get mode(): RuntimeMode {
    return this.delegate.mode;
  }

  get licenseChecker() {
    return this.delegate.licenseChecker;
  }

  get debugEventBus() {
    return this.delegate.debugEventBus;
  }

  get debug(): ResolvedDebugConfig {
    return this.delegate.debug;
  }

  get debugLogger(): CopilotRuntimeLogger | undefined {
    return this.delegate.debugLogger;
  }

  get forwardHeadersPolicy(): ResolvedForwardHeadersPolicy {
    return this.delegate.forwardHeadersPolicy;
  }

  get exposeMemoryRoutes(): boolean | undefined {
    return this.delegate.exposeMemoryRoutes;
  }
}

/**
 * The public `CopilotRuntime` constructor. Backed by {@link CopilotRuntimeShim}
 * but typed as {@link CopilotRuntimeConstructor} so that constructing with a
 * non-empty `channels` array yields a {@link RuntimeWithDeclaredChannels}-branded
 * runtime type.
 *
 * The `as unknown as` cast is required (not dishonest widening): the brand is a
 * phantom, compile-time-only marker with no runtime representation, so the shim
 * instances legitimately do not carry the brand property. Behavior is identical
 * to the former `class CopilotRuntime` — this only refines the static type.
 */
export const CopilotRuntime: CopilotRuntimeConstructor =
  CopilotRuntimeShim as unknown as CopilotRuntimeConstructor;
