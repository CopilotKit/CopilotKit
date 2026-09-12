import type { AbstractAgent, ToolCall } from "@ag-ui/client";
import type {
  InspectorMetadataV1,
  IntelligenceRuntimeInfo,
  RuntimeMode,
  RuntimeLicenseStatus,
  ThreadEndpointRuntimeInfo,
} from "@copilotkit/shared";
import type { StandardSchemaV1 } from "@copilotkit/shared";

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
};

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
  name: string;
  description?: string;
  parameters?: StandardSchemaV1<any, T>;
  handler?: (args: T, context: FrontendToolHandlerContext) => Promise<unknown>;
  followUp?: boolean;
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
