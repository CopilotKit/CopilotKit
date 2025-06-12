import {
  type ErrorHandlerResult,
  type BaseErrorContext,
  type CopilotRuntimeError,
  type AgentError,
  type LLMProviderError,
  type ActionExecutionError,
  type NetworkError,
  type RuntimeError,
  type ComponentError,
  type ConcurrencyError,
  type SecurityError,
  type DataProcessingError,
  type ResourceError,
  type IntegrationError,
  isAgentError,
  isLLMProviderError,
  isActionExecutionError,
  isNetworkError,
  isRuntimeError,
  isComponentError,
  isSecurityError,
  isValidationError,
  categorizeError,
  createLLMProviderError,
  type ErrorHandler,
  type ErrorCategorizer,
  errorCategorizerRegistry,
} from "@copilotkit/shared";

// Legacy aliases for backward compatibility
export type CopilotError = CopilotRuntimeError;
export type CopilotClientError = CopilotRuntimeError;
export type CopilotComponentError = ComponentError;
export type CopilotNetworkError = NetworkError;
export type CopilotValidationError = DataProcessingError;
export type CopilotAuthError = SecurityError;

// Re-export types from shared
export type {
  ErrorHandlerResult,
  BaseErrorContext,
  CopilotRuntimeError,
  AgentError,
  LLMProviderError,
  ActionExecutionError,
  NetworkError,
  RuntimeError,
  ComponentError,
  ConcurrencyError,
  SecurityError,
  DataProcessingError,
  ResourceError,
  IntegrationError,
  ErrorHandler,
  ErrorCategorizer,
};

// Re-export functions from shared
export {
  isAgentError,
  isLLMProviderError,
  isActionExecutionError,
  isNetworkError,
  isRuntimeError,
  isComponentError,
  isSecurityError,
  isValidationError,
  categorizeError,
  createLLMProviderError,
  errorCategorizerRegistry,
};

// Additional type guards for compatibility
export function isClientError(error: CopilotRuntimeError): error is CopilotRuntimeError {
  return true; // All errors are client errors in this context
}

export function isAuthError(error: CopilotRuntimeError): error is SecurityError {
  return isSecurityError(error);
}

// Error creation helpers for React-specific errors
export function createComponentError(
  type: ComponentError["type"],
  originalError?: Error,
  context: Partial<BaseErrorContext> & {
    componentName?: string;
    hookName?: string;
    message?: string;
  } = {},
): ComponentError {
  return {
    category: "component",
    type,
    timestamp: Date.now(),
    originalError,
    message: context.message || originalError?.message || "Component error occurred",
    componentName: context.componentName,
    hookName: context.hookName,
    threadId: context.threadId,
    runId: context.runId,
    url: context.url,
  };
}

export function createNetworkError(
  type: NetworkError["type"],
  originalError?: Error,
  context: Partial<BaseErrorContext> & {
    endpoint?: string;
    statusCode?: number;
    message?: string;
  } = {},
): NetworkError {
  return {
    category: "network",
    type,
    timestamp: Date.now(),
    originalError,
    message: context.message || originalError?.message || "Network error occurred",
    endpoint: context.endpoint,
    statusCode: context.statusCode,
    threadId: context.threadId,
    runId: context.runId,
    url: context.url,
  };
}

export function createValidationError(
  type: DataProcessingError["type"],
  originalError?: Error,
  context: Partial<BaseErrorContext> & {
    data?: any;
    message?: string;
  } = {},
): DataProcessingError {
  return {
    category: "data_processing",
    type,
    timestamp: Date.now(),
    originalError,
    message: context.message || originalError?.message || "Validation error occurred",
    data: context.data,
    threadId: context.threadId,
    runId: context.runId,
    url: context.url,
  };
}

export function createAuthError(
  type: SecurityError["type"],
  originalError?: Error,
  context: Partial<BaseErrorContext> & {
    message?: string;
  } = {},
): SecurityError {
  return {
    category: "security",
    type,
    timestamp: Date.now(),
    originalError,
    message: context.message || originalError?.message || "Authentication error occurred",
    threadId: context.threadId,
    runId: context.runId,
    url: context.url,
  };
}

export function createRuntimeError(
  type: RuntimeError["type"],
  originalError?: Error,
  context: Partial<BaseErrorContext> & {
    message?: string;
  } = {},
): RuntimeError {
  return {
    category: "runtime",
    type,
    timestamp: Date.now(),
    originalError,
    message: context.message || originalError?.message || "Runtime error occurred",
    threadId: context.threadId,
    runId: context.runId,
    url: context.url,
  };
}

// Client-side error handling - no sanitization needed since server already sanitizes

// Simple error serialization for JSON transport (no sanitization - that's server-side)
function serializeErrorForTransport(error: unknown): any {
  if (error instanceof Error) {
    const serialized: any = {
      name: error.name,
      message: error.message,
    };

    // Include stack in development for debugging
    if (process.env.NODE_ENV === "development" && error.stack) {
      serialized.stack = error.stack;
    }

    // Handle nested causes
    if ("cause" in error && error.cause) {
      serialized.cause = serializeErrorForTransport(error.cause);
    }

    return serialized;
  }
  return error;
}

// Client-side error handling - simplified since server already sanitizes errors
function enhancedClientCategorization(
  error: unknown,
  context: Partial<BaseErrorContext> = {},
): CopilotRuntimeError {
  // Use the base categorization with proper error serialization
  const baseResult = categorizeError(error, context);

  // Ensure originalError is properly serialized for JSON transport
  if (baseResult.originalError instanceof Error) {
    return {
      ...baseResult,
      originalError: serializeErrorForTransport(baseResult.originalError),
    };
  }

  return baseResult;
}

// Legacy compatibility - old function names and signatures
export const categorizeCopilotError = enhancedClientCategorization;
export const isCopilotComponentError = isComponentError;
export const isCopilotNetworkError = isNetworkError;
export const isCopilotRuntimeError = isRuntimeError;
export const isCopilotValidationError = isValidationError;
export const isCopilotAuthError = isAuthError;

// Legacy error handler interface
export interface CopilotErrorHandler extends ErrorHandler {}

// Legacy error creation object
export const createCopilotError = {
  invalidApiKey: (message = "Invalid API key provided") =>
    createAuthError("invalid_token", undefined, { message }),

  networkTimeout: (endpoint?: string, timeout = 30000) =>
    createNetworkError("timeout", undefined, {
      endpoint,
      message: `Request to ${endpoint || "server"} timed out after ${timeout}ms`,
    }),

  componentFailed: (componentName: string, error: Error) =>
    createComponentError("render_failed", error, { componentName }),

  hookError: (hookName: string, error: Error) =>
    createComponentError("hook_error", error, { hookName }),

  actionFailed: (actionName: string, error: Error) =>
    createRuntimeError("internal_error", error, {
      message: `Action ${actionName} failed: ${error.message}`,
    }),

  agentFailed: (agentName: string, error: Error) =>
    createRuntimeError("internal_error", error, {
      message: `Agent ${agentName} failed: ${error.message}`,
    }),

  missingConfig: (field: string, expectedType?: string) =>
    createValidationError("validation_failed", undefined, {
      message: `Missing required configuration: ${field}${expectedType ? ` (expected ${expectedType})` : ""}`,
      data: { field, expectedType },
    }),
};
