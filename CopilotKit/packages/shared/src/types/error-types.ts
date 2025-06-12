export type ErrorHandlerResult = "handled" | "default";

// Base error interface
export interface BaseErrorContext {
  threadId?: string;
  runId?: string;
  timestamp: number;
  url?: string;
}

// Unified error categories with discriminated union
export type CopilotRuntimeError =
  | AgentError
  | LLMProviderError
  | ActionExecutionError
  | NetworkError
  | RuntimeError
  | ComponentError
  | ConcurrencyError
  | SecurityError
  | DataProcessingError
  | ResourceError
  | IntegrationError;

export interface AgentError extends BaseErrorContext {
  category: "agent";
  type: "execution_failed" | "not_found" | "timeout" | "invalid_state";
  agentName?: string;
  nodeName?: string;
  originalError?: Error;
  message: string;
}

export interface LLMProviderError extends BaseErrorContext {
  category: "llm_provider";
  type:
    | "auth_failed"
    | "quota_exceeded"
    | "rate_limited"
    | "model_unavailable"
    | "invalid_request"
    | "server_error";
  provider?: string;
  model?: string;
  originalError?: Error;
  message: string;
  retryAfter?: number; // For rate limiting
}

export interface ActionExecutionError extends BaseErrorContext {
  category: "action_execution";
  type: "function_failed" | "validation_error" | "timeout" | "permission_denied";
  actionName: string;
  originalError?: Error;
  message: string;
  userMessage?: string; // Safe message for end users
}

export interface NetworkError extends BaseErrorContext {
  category: "network";
  type: "connection_failed" | "timeout" | "dns_error" | "ssl_error";
  endpoint?: string;
  statusCode?: number;
  originalError?: Error;
  message: string;
}

export interface RuntimeError extends BaseErrorContext {
  category: "runtime";
  type: "stream_interrupted" | "graphql_error" | "processing_failed" | "internal_error";
  originalError?: Error;
  message: string;
}

export interface ComponentError extends BaseErrorContext {
  category: "component";
  type: "render_failed" | "hook_error" | "state_error" | "lifecycle_error";
  componentName?: string;
  hookName?: string;
  originalError?: Error;
  message: string;
}

export interface ConcurrencyError extends BaseErrorContext {
  category: "concurrency";
  type: "race_condition" | "deadlock" | "thread_conflict" | "resource_busy";
  resourceId?: string;
  originalError?: Error;
  message: string;
}

export interface SecurityError extends BaseErrorContext {
  category: "security";
  type: "cors_error" | "auth_required" | "invalid_token" | "permission_denied" | "rate_limited";
  originalError?: Error;
  message: string;
}

export interface DataProcessingError extends BaseErrorContext {
  category: "data_processing";
  type: "parse_error" | "validation_failed" | "schema_mismatch" | "encoding_error";
  data?: any;
  originalError?: Error;
  message: string;
}

export interface ResourceError extends BaseErrorContext {
  category: "resource";
  type: "memory_exceeded" | "storage_full" | "cpu_overload" | "connection_limit";
  resourceType?: string;
  currentUsage?: number;
  limit?: number;
  originalError?: Error;
  message: string;
}

export interface IntegrationError extends BaseErrorContext {
  category: "integration";
  type: "service_unavailable" | "api_error" | "version_mismatch" | "configuration_error";
  serviceName?: string;
  originalError?: Error;
  message: string;
}

// Type guards for error categorization
export function isAgentError(error: CopilotRuntimeError): error is AgentError {
  return error.category === "agent";
}

export function isLLMProviderError(error: CopilotRuntimeError): error is LLMProviderError {
  return error.category === "llm_provider";
}

export function isActionExecutionError(error: CopilotRuntimeError): error is ActionExecutionError {
  return error.category === "action_execution";
}

export function isNetworkError(error: CopilotRuntimeError): error is NetworkError {
  return error.category === "network";
}

export function isRuntimeError(error: CopilotRuntimeError): error is RuntimeError {
  return error.category === "runtime";
}

export function isComponentError(error: CopilotRuntimeError): error is ComponentError {
  return error.category === "component";
}

export function isSecurityError(error: CopilotRuntimeError): error is SecurityError {
  return error.category === "security";
}

export function isValidationError(error: CopilotRuntimeError): error is DataProcessingError {
  return error.category === "data_processing";
}

// Error handler interface
export interface ErrorHandler {
  (error: CopilotRuntimeError): ErrorHandlerResult | Promise<ErrorHandlerResult>;
}

// Error categorizer interface - adapters implement this
export interface ErrorCategorizer {
  categorizeError(error: unknown, context?: Partial<BaseErrorContext>): CopilotRuntimeError | null;
}

// Registry for provider-specific error categorizers
class ErrorCategorizerRegistry {
  private categorizers: ErrorCategorizer[] = [];

  register(categorizer: ErrorCategorizer): void {
    this.categorizers.push(categorizer);
  }

  categorize(error: unknown, context: Partial<BaseErrorContext> = {}): CopilotRuntimeError {
    const baseContext: BaseErrorContext = {
      timestamp: Date.now(),
      ...context,
    };

    // Try each registered categorizer
    for (const categorizer of this.categorizers) {
      const result = categorizer.categorizeError(error, baseContext);
      if (result) {
        return result;
      }
    }

    // Fallback to generic categorization
    return this.fallbackCategorization(error, baseContext);
  }

  private fallbackCategorization(
    error: unknown,
    baseContext: BaseErrorContext,
  ): CopilotRuntimeError {
    // Basic fallback based on common error patterns
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      const errorName = error.name.toLowerCase();

      // Network-related errors
      if (
        errorMessage.includes("fetch") ||
        errorMessage.includes("network") ||
        errorMessage.includes("connection") ||
        errorName.includes("networkerror")
      ) {
        return {
          ...baseContext,
          category: "network",
          type: "connection_failed",
          originalError: error,
          message: error.message,
        };
      }

      // Timeout errors
      if (errorMessage.includes("timeout") || errorName.includes("timeout")) {
        return {
          ...baseContext,
          category: "network",
          type: "timeout",
          originalError: error,
          message: error.message,
        };
      }

      // CORS errors
      if (errorMessage.includes("cors") || errorMessage.includes("cross-origin")) {
        return {
          ...baseContext,
          category: "security",
          type: "cors_error",
          originalError: error,
          message: error.message,
        };
      }
    }

    // Default to runtime error
    return {
      ...baseContext,
      category: "runtime",
      type: "internal_error",
      originalError: error instanceof Error ? error : undefined,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// Global registry instance
export const errorCategorizerRegistry = new ErrorCategorizerRegistry();

// Basic fallback categorization (no provider-specific logic here)
export function categorizeError(
  error: unknown,
  context: Partial<BaseErrorContext> = {},
): CopilotRuntimeError {
  return errorCategorizerRegistry.categorize(error, context);
}

// Helper function to create LLM provider errors with proper typing
export function createLLMProviderError(
  type: LLMProviderError["type"],
  originalError: Error,
  context: Partial<BaseErrorContext> & {
    provider?: string;
    model?: string;
    retryAfter?: number;
    message?: string;
  } = {},
): LLMProviderError {
  return {
    category: "llm_provider",
    type,
    timestamp: Date.now(),
    originalError,
    message: context.message || originalError.message,
    provider: context.provider,
    model: context.model,
    retryAfter: context.retryAfter,
    threadId: context.threadId,
    runId: context.runId,
    url: context.url,
  };
}
