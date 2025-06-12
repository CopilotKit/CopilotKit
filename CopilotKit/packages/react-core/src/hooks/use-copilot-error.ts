import { useCallback } from "react";
import { useCopilotContext } from "../context/copilot-context";
import {
  CopilotRuntimeError,
  createComponentError,
  createNetworkError,
  createAuthError,
  createValidationError,
  createRuntimeError,
  isComponentError,
  isNetworkError,
  isRuntimeError,
  isValidationError,
  isAuthError,
} from "../types/error-handler";

/**
 * Hook for handling errors in CopilotKit components and actions.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { handleError, createError } = useCopilotError('MyComponent');
 *
 *   const handleClick = async () => {
 *     try {
 *       await someAsyncOperation();
 *     } catch (error) {
 *       await handleError(error);
 *     }
 *   };
 *
 *   const handleInvalidInput = () => {
 *     const error = createError.missingConfig('apiKey', 'string');
 *     handleError(error);
 *   };
 *
 *   return <button onClick={handleClick}>Click me</button>;
 * }
 * ```
 */
export function useCopilotError(componentName?: string) {
  const { handleError: contextHandleError } = useCopilotContext();

  // Wrapper that adds component context
  const handleError = useCallback(
    async (
      error: unknown,
      context: Partial<{ hookName: string; actionName: string }> = {},
    ): Promise<void> => {
      await contextHandleError(error, {
        componentName,
        ...context,
      });
    },
    [contextHandleError, componentName],
  );

  // Create specific error types with component context
  const createError = {
    // Component errors
    hookError: useCallback(
      (hookName: string, error: Error): CopilotRuntimeError =>
        createComponentError("hook_error", error, { componentName, hookName }),
      [componentName],
    ),

    actionFailed: useCallback(
      (actionName: string, error: Error): CopilotRuntimeError =>
        createRuntimeError("internal_error", error, {
          message: `Action ${actionName} failed: ${error.message}`,
        }),
      [],
    ),

    componentFailed: useCallback(
      (error: Error): CopilotRuntimeError =>
        createComponentError("render_failed", error, { componentName }),
      [componentName],
    ),

    // Network errors
    networkTimeout: useCallback(
      (endpoint?: string, timeout?: number): CopilotRuntimeError =>
        createNetworkError("timeout", undefined, {
          endpoint,
          message: `Request to ${endpoint || "server"} timed out after ${timeout || 30000}ms`,
        }),
      [],
    ),

    // Auth errors
    invalidApiKey: useCallback(
      (message = "Invalid API key provided"): CopilotRuntimeError =>
        createAuthError("invalid_token", undefined, { message }),
      [],
    ),

    // Validation errors
    missingConfig: useCallback(
      (field: string, expectedType?: string): CopilotRuntimeError =>
        createValidationError("validation_failed", undefined, {
          message: `Missing required configuration: ${field}${expectedType ? ` (expected ${expectedType})` : ""}`,
          data: { field, expectedType },
        }),
      [],
    ),

    // Agent errors
    agentFailed: useCallback(
      (agentName: string, error: Error): CopilotRuntimeError =>
        createRuntimeError("internal_error", error, {
          message: `Agent ${agentName} failed: ${error.message}`,
        }),
      [],
    ),
  };

  return {
    handleError,
    createError,
    // Type guards for error handling
    isComponentError,
    isNetworkError,
    isRuntimeError,
    isValidationError,
    isAuthError,
  };
}

/**
 * Hook for wrapping async operations with automatic error handling.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { wrapAsync } = useCopilotErrorBoundary('MyComponent');
 *
 *   const handleSubmit = wrapAsync(async (data) => {
 *     // This will automatically handle any errors
 *     const result = await submitData(data);
 *     return result;
 *   });
 *
 *   return <form onSubmit={handleSubmit}>...</form>;
 * }
 * ```
 */
export function useCopilotErrorBoundary(componentName?: string) {
  const { handleError } = useCopilotError(componentName);

  const wrapAsync = useCallback(
    <T extends any[], R>(fn: (...args: T) => Promise<R>) => {
      return async (...args: T): Promise<R | void> => {
        try {
          return await fn(...args);
        } catch (error) {
          await handleError(error);
          // Return void to indicate error was handled
        }
      };
    },
    [handleError],
  );

  const wrapSync = useCallback(
    <T extends any[], R>(fn: (...args: T) => R) => {
      return (...args: T): R | void => {
        try {
          return fn(...args);
        } catch (error) {
          handleError(error);
          // Return void to indicate error was handled
        }
      };
    },
    [handleError],
  );

  return {
    wrapAsync,
    wrapSync,
    handleError,
  };
}
