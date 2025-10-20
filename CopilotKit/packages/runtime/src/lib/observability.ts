import { RuntimeEventSource, RuntimeEventTypes } from "../service-adapters/events";

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

/**
 * Setup progressive logging by wrapping the event stream
 */
function setupProgressiveLogging(
  eventSource: RuntimeEventSource,
  streamedChunks: any[],
  requestStartTime: number,
  context: {
    threadId?: string;
    runId?: string;
    model?: string;
    provider?: string;
    agentName?: string;
    nodeName?: string;
  },
  publicApiKey?: string,
): void {
  if (this.observability?.enabled && this.observability.progressive && publicApiKey) {
    // Keep reference to original stream function
    const originalStream = eventSource.stream.bind(eventSource);

    // Wrap the stream function to intercept events
    eventSource.stream = async (callback) => {
      await originalStream(async (eventStream$) => {
        // Create subscription to capture streaming events
        eventStream$.subscribe({
          next: (event) => {
            // Only log content chunks
            if (event.type === RuntimeEventTypes.TextMessageContent) {
              // Store the chunk
              streamedChunks.push(event.content);

              // Log each chunk separately for progressive mode
              try {
                const progressiveData: LLMResponseData = {
                  threadId: context.threadId || "",
                  runId: context.runId,
                  model: context.model,
                  output: event.content,
                  latency: Date.now() - requestStartTime,
                  timestamp: Date.now(),
                  provider: context.provider,
                  isProgressiveChunk: true,
                  agentName: context.agentName,
                  nodeName: context.nodeName,
                };

                // Use Promise to handle async logger without awaiting
                Promise.resolve()
                  .then(() => {
                    this.observability.hooks.handleResponse(progressiveData);
                  })
                  .catch((error) => {
                    console.error("Error in progressive logging:", error);
                  });
              } catch (error) {
                console.error("Error preparing progressive log data:", error);
              }
            }
          },
        });

        // Call the original callback with the event stream
        await callback(eventStream$);
      });
    };
  }
}

/**
 * Log error if observability is enabled
 */
async function logObservabilityError(
  errorData: LLMErrorData,
  publicApiKey?: string,
): Promise<void> {
  if (this.observability?.enabled && publicApiKey) {
    try {
      await this.observability.hooks.handleError(errorData);
    } catch (logError) {
      console.error("Error logging LLM error:", logError);
    }
  }
}
