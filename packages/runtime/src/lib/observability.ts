export interface LLMRequestData {
  threadId?: string;
  runId?: string;
  model?: string;
  messages: any[];
  actions?: any[];
  forwardedParameters?: any;
  timestamp: number;
  provider?: string;
  [key: string]: any;
}

export interface LLMResponseData {
  threadId: string;
  runId?: string;
  model?: string;
  output: any;
  latency: number;
  timestamp: number;
  provider?: string;
  isProgressiveChunk?: boolean;
  isFinalResponse?: boolean;
  [key: string]: any;
}

export interface LLMErrorData {
  threadId?: string;
  runId?: string;
  model?: string;
  error: Error | string;
  timestamp: number;
  provider?: string;
  [key: string]: any;
}

export interface CopilotObservabilityHooks {
  handleRequest: (data: LLMRequestData) => void | Promise<void>;
  handleResponse: (data: LLMResponseData) => void | Promise<void>;
  handleError: (data: LLMErrorData) => void | Promise<void>;
}

/**
 * Configuration for CopilotKit logging functionality.
 *
 * @remarks
 * Custom logging handlers require a valid CopilotKit public API key.
 * Sign up at https://docs.copilotkit.ai/quickstart#get-a-copilot-cloud-public-api-key to get your key.
 */
export interface CopilotObservabilityConfig {
  /**
   * Enable or disable logging functionality.
   *
   * @default false
   */
  enabled: boolean;

  /**
   * Controls whether logs are streamed progressively or buffered.
   * - When true: Each token and update is logged as it's generated (real-time)
   * - When false: Complete responses are logged after completion (batched)
   *
   * @default true
   */
  progressive: boolean;

  /**
   * Custom observability hooks for request, response, and error events.
   *
   * @remarks
   * Using custom observability hooks requires a valid CopilotKit public API key.
   */
  hooks: CopilotObservabilityHooks;
}
