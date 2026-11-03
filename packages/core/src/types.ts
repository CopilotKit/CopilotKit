import type { AbstractAgent, ToolCall } from "@ag-ui/client";
import type {
  InspectorMetadataV1,
  IntelligenceRuntimeInfo,
  RuntimeMode,
  RuntimeLicenseStatus,
  ThreadEndpointRuntimeInfo,
} from "@copilotkit/shared";
import type { DebugConfig, StandardSchemaV1 } from "@copilotkit/shared";
import type { CopilotKitCoreErrorHandler } from "./core/core";
import type { CopilotKitHeadersSource } from "./core/header-source";
import type { LearningConfig } from "./core/learning-bridge";
import type { CopilotKitMessageFilter } from "./core/message-filter";

/**
 * Status of a tool call execution
 */
export enum ToolCallStatus {
  InProgress = "inProgress",
  Executing = "executing",
  Complete = "complete",
}

export type CopilotRuntimeTransport = "rest" | "single" | "auto";
export type {
  InspectorMetadataV1,
  RuntimeMode,
  IntelligenceRuntimeInfo,
  RuntimeLicenseStatus,
  ThreadEndpointRuntimeInfo,
};

/**
 * Context passed to a frontend tool handler
 */
export type FrontendToolHandlerContext = {
  toolCall: ToolCall;
  /**
   * The agent that invoked the tool. Absent when the tool is invoked through
   * the WebMCP browser API (`document.modelContext`), which has no agent.
   */
  agent?: AbstractAgent;
  /** Aborted when `stopAgent()` is called. Handlers can check `signal.aborted`
   *  or pass the signal to fetch/setTimeout to cooperatively cancel. */
  signal?: AbortSignal;
  /**
   * True when CopilotKit runs this call while restoring a thread's history on
   * connect, for a call that a previous page or client left without a result.
   * Absent for a call made by a live run. See `reconnectBehavior`.
   */
  isReplay?: boolean;
};

/**
 * What a frontend tool does with its own calls that are still unanswered when
 * a thread's history is restored (a reload, a remount, or a thread switch).
 * Only calls after the latest user message are eligible; older unanswered
 * calls remain historical and never resume work on reconnect.
 *
 * - `"passive"` (default) — show the call, but do not run the handler. Nothing
 *   the handler did runs twice.
 * - `"resume-pending"` — run the handler for each call that has no result,
 *   with `isReplay: true` in its context, then continue the run as usual
 *   (follow-up included, unless `followUp` is false).
 *
 * Use `"resume-pending"` only for a handler that is safe to run more than
 * once. A call does not start twice at the same time in one CopilotKit
 * instance, but it can run again after a stop or a thread switch if its result
 * never reached the agent, and two tabs or devices that restore the same
 * thread can each run it.
 *
 * If one assistant message also calls a tool that stays passive, the follow-up
 * run sends that call without a result, which some model providers reject.
 * Opt in every tool the agent calls together, or set `followUp: false`.
 */
export type FrontendToolReconnectBehavior = "passive" | "resume-pending";

/**
 * Annotations for a WebMCP tool, passed through to
 * `document.modelContext.registerTool`. Mirrors the WebMCP spec's tool
 * annotations. These are hints for browser agents only — they do not enforce
 * any policy on their own.
 */
export type WebMCPToolAnnotations = {
  /**
   * Hint that the tool does not modify state. Defaults to false.
   * Set it for read-only tools (search, status lookup, ...).
   */
  readOnlyHint?: boolean;
  /**
   * Hint that the tool's output may contain untrusted content
   * (e.g. user-generated or external content). Defaults to false.
   */
  untrustedContentHint?: boolean;
};

/**
 * WebMCP registration options for a frontend tool.
 */
export type WebMCPToolConfig = {
  /** Hints that tell browser agents how the tool behaves. */
  annotations?: WebMCPToolAnnotations;
};

export type FrontendTool<
  T extends Record<string, unknown> = Record<string, unknown>,
> = {
  /**
   * @internal Classifies local execution. Omitted means an ordinary frontend
   * tool. Pending calls in the latest user turn are eligible for restoration.
   * Human-in-the-loop handlers are restored from history replay;
   * other handlers only with `reconnectBehavior: "resume-pending"`. Tools
   * without a handler restore missing empty completion results automatically.
   * This field is not sent to the agent as part of the tool schema.
   */
  type?: "frontend" | "human-in-the-loop";
  name: string;
  description?: string;
  parameters?: StandardSchemaV1<any, T>;
  handler?: (args: T, context: FrontendToolHandlerContext) => Promise<unknown>;
  followUp?: boolean;
  /**
   * Whether to run the handler again for a call that is still unanswered when
   * the thread's history is restored. Defaults to `"passive"`. See
   * {@link FrontendToolReconnectBehavior}.
   */
  reconnectBehavior?: FrontendToolReconnectBehavior;
  /**
   * Optional agent ID to constrain this tool to a specific agent.
   * If specified, this tool will only be available to the specified agent.
   */
  agentId?: string;
  /**
   * Whether this tool is available to the agent.
   * Set to false to hide the tool from the agent without unregistering it.
   * Defaults to true when not specified.
   */
  available?: boolean;
  /**
   * Also expose this tool to browser agents through the WebMCP API
   * (`document.modelContext`) while keeping the normal agent registration.
   *
   * - `true` — register with default annotations.
   * - `{ annotations }` — register with the given WebMCP annotations.
   * - `false` / `undefined` — do not register.
   *
   * The tool's `handler` runs when a browser agent calls the tool; the handler
   * context then has no `agent`. No-op in environments without WebMCP support
   * (e.g. React Native, or browsers without the API enabled).
   */
  webmcp?: boolean | WebMCPToolConfig;
};

export type Suggestion = {
  title: string;
  message: string;
  /** Indicates whether this suggestion is still being generated. */
  isLoading: boolean;
  /** Optional CSS class name applied to the suggestion pill. */
  className?: string;
};

export type SuggestionAvailability =
  | "before-first-message"
  | "after-first-message"
  | "always"
  | "disabled";

export type DynamicSuggestionsConfig = {
  /**
   * A prompt or instructions for the GPT to generate suggestions.
   */
  instructions: string;
  /**
   * The minimum number of suggestions to generate. Defaults to `1`.
   * @default 1
   */
  minSuggestions?: number;
  /**
   * The maximum number of suggestions to generate. Defaults to `3`.
   * @default 1
   */
  maxSuggestions?: number;

  /**
   * When the suggestions are available. Defaults to "after-first-message".
   */
  available?: SuggestionAvailability;

  /**
   * The agent ID of the provider of the suggestions. Defaults to `"default"`.
   */
  providerAgentId?: string;

  /**
   * The agent ID of the consumer of the suggestions. Defaults to `"*"` (all agents).
   */
  consumerAgentId?: string;
};

export type StaticSuggestionsConfig = {
  /**
   * The suggestions to display.
   */
  suggestions: Omit<Suggestion, "isLoading">[];

  /**
   * When the suggestions are available. Defaults to "before-first-message".
   */
  available?: SuggestionAvailability;

  /**
   * The agent ID of the consumer of the suggestions. Defaults to `"*"` (all agents).
   */
  consumerAgentId?: string;
};

export type SuggestionsConfig =
  | DynamicSuggestionsConfig
  | StaticSuggestionsConfig;

/** @internal The object form of the provider `learning` option. */
export type ɵCopilotKitLearningOptions = LearningConfig & {
  /**
   * Starts a Trajectory after mount. Defaults to `true`; set `false` to call
   * `startTrajectory()` yourself.
   */
  autoStart?: boolean;
  trajectoryId?: string;
  /**
   * Used only by explicit custom sinks. Authenticated capture warns and ignores
   * this option; assign Learning Spaces on the server with
   * `getTrajectoryLearningContainerIds` on `CopilotKitIntelligence`.
   */
  learningContainerIds?: string[];
};

/** @internal The `a2ui` provider options every framework shares. */
export interface ɵA2UIBaseOptions {
  /**
   * When true (the default), the full component schemas from the catalog are
   * sent as agent context so the agent knows what components and props are
   * available. The A2UI middleware can overwrite this with a server-side
   * schema if configured.
   *
   * When false, the agent context still describes the catalog, but only by its
   * catalog ID and the names of its custom components, without their JSON
   * schemas. The component schema entry and the A2UI generation and design
   * guidelines are not sent. With the CopilotKit LangGraph middleware's
   * injected A2UI tool, the A2UI subagent then gets the component names only;
   * a host can still give it a composition guide through the middleware's
   * guidelines (`a2uiParams.guidelines.compositionGuide` in TypeScript,
   * `a2ui_params["guidelines"]["composition_guide"]` in Python).
   */
  includeSchema?: boolean;
}

/**
 * @internal The provider options that React, Vue and React Native share with
 * the same names. The framework props extend this type, so the docs live in
 * one place. Angular picks the options whose names match.
 */
export interface ɵCopilotKitProviderBaseOptions {
  /** The endpoint of your CopilotRuntime. */
  runtimeUrl?: string;
  /**
   * Headers sent with every request. A record, or a sync or async builder
   * that runs when each request is sent. An inline arrow is fine. The builder
   * should be cheap; cache tokens in it (Clerk's `getToken()` already does).
   */
  headers?: CopilotKitHeadersSource;
  /**
   * Credentials mode for fetch requests (e.g., "include" for HTTP-only cookies in cross-origin requests).
   */
  credentials?: RequestCredentials;
  /**
   * Rewrites the message list sent to runtime agents on every run.
   *
   * CopilotKit sends the whole thread each time. When your agent already
   * stores the conversation, most of that payload is waste, and an agent that
   * merges the inbound list with its own store can show the model every turn
   * twice. Return the messages to send:
   *
   * ```ts
   * messageFilter: (messages) => messages.slice(-1)
   * ```
   *
   * The filter changes the request body only. The transcript the UI renders is
   * untouched. Broken tool-call pairs are repaired before the request is sent,
   * so a filter this blunt cannot strand a tool result mid-HITL.
   *
   * Agents reached through your CopilotRuntime honor this. An agent your app
   * passes in directly does not, and neither Intelligence runs nor suggestion
   * runs are ever filtered.
   *
   * Prefer a stable function reference. A new function on every render
   * re-registers the filter, which is harmless but needless.
   */
  messageFilter?: CopilotKitMessageFilter;
  /** Your CopilotKit public license key. */
  publicApiKey?: string;
  /** Your public license key for accessing CopilotKit Intelligence features. */
  publicLicenseKey?: string;
  /**
   * Signed license token for offline verification of CopilotKit Intelligence features.
   * Obtain from https://dashboard.operations.copilotkit.ai.
   */
  licenseToken?: string;
  /** Properties sent as `forwardedProps` with every agent run. */
  properties?: Record<string, unknown>;
  /**
   * `true` uses the single-route runtime transport, `false` the REST
   * transport. Omit it to detect the transport from the runtime.
   */
  useSingleEndpoint?: boolean;
  /** Local agents, keyed by id. For development only; production uses CopilotRuntime. */
  agents__unsafe_dev_only?: Record<string, AbstractAgent>;
  /**
   * Agents you host yourself, keyed by id. Part of the Enterprise
   * Intelligence tier: set `publicLicenseKey` for production use.
   */
  selfManagedAgents?: Record<string, AbstractAgent>;
  /**
   * Error handler called when CopilotKit encounters an error.
   * Fires for all error types (runtime connection failures, agent errors, tool errors).
   * Without a handler, errors are logged with `console.error`.
   */
  onError?: CopilotKitCoreErrorHandler;
  /**
   * Default throttle interval (in milliseconds) for agent re-renders
   * triggered by `OnMessagesChanged` notifications. This value is used as
   * a fallback when neither the agent hook nor the chat component
   * specifies an explicit `throttleMs`.
   *
   * @default undefined (no throttling)
   */
  defaultThrottleMs?: number;
  /**
   * Enable debug logging for the client-side event pipeline.
   *
   * Accepts:
   * - `true` / `false` to toggle events + lifecycle logging (verbose off).
   * - `{ events?: boolean; lifecycle?: boolean; verbose?: boolean }` for granular control.
   */
  debug?: DebugConfig;
  /** Configuration for the built-in MCP Apps renderer. */
  mcpApps?: {
    /**
     * Restore `allow-same-origin` on the MCP App sandbox. Default `false`.
     *
     * **Unsafe.** The widget then runs with your page's origin: it can read
     * your cookies, storage and DOM, and call your APIs as the signed-in user.
     * Only set it for widgets you wrote and trust that need `localStorage`,
     * `IndexedDB` or cookies. By default widgets get an opaque origin.
     */
    allowSameOriginFallback?: boolean;
  };
  /**
   * Turns on interaction capture (`@copilotkit/learning`). `true` records
   * with the default options; pass an object for options. `false` or
   * omitting the option turns capture off and cancels startup. Without a
   * sink, Core authenticates with the runtime and sends browser events to
   * Intelligence; a custom sink keeps the standalone collector behavior.
   * Updated settings apply to the next Trajectory.
   *
   * Capture starts after mount. Set `trajectoryId` to use your own ID;
   * otherwise the provider generates one. The generated ID stays the same
   * across rerenders, reconnects and option changes; turning capture off,
   * setting `autoStart: false` or supplying a `trajectoryId` ends it, and the
   * next generated Trajectory gets a new ID. Read the active ID from
   * `copilotkit.trajectoryId`.
   *
   * Set `autoStart: false` to start capture yourself with `startTrajectory()`.
   * Capture stops on unmount, including manually started Trajectories.
   */
  learning?: boolean | ɵCopilotKitLearningOptions;
}
