import React, { useCallback } from "react";
import { GraphQLError } from "@copilotkit/runtime-client-gql";
import { useToast } from "../toast/toast-provider";
import { ExclamationMarkIcon } from "../toast/exclamation-mark-icon";
import ReactMarkdown from "react-markdown";
import {
  CopilotKitError,
  CopilotKitErrorCode,
  CopilotKitApiDiscoveryError,
  CopilotKitRemoteEndpointDiscoveryError,
  CopilotKitAgentDiscoveryError,
  CopilotErrorEvent,
} from "@copilotkit/shared";

interface OriginalError {
  message?: string;
  stack?: string;
}

export function ErrorToast({ errors }: { errors: (Error | GraphQLError)[] }) {
  const errorsToRender = errors.map((error, idx) => {
    const originalError =
      "extensions" in error ? (error.extensions?.originalError as undefined | OriginalError) : {};
    const message = originalError?.message ?? error.message;
    const code = "extensions" in error ? (error.extensions?.code as string) : null;

    return (
      <div
        key={idx}
        style={{
          marginTop: idx === 0 ? 0 : 10,
          marginBottom: 14,
        }}
      >
        <ExclamationMarkIcon style={{ marginBottom: 4 }} />

        {code && (
          <div
            style={{
              fontWeight: "600",
              marginBottom: 4,
            }}
          >
            Copilot Runtime Error:{" "}
            <span style={{ fontFamily: "monospace", fontWeight: "normal" }}>{code}</span>
          </div>
        )}
        <ReactMarkdown>{message}</ReactMarkdown>
      </div>
    );
  });
  return (
    <div
      style={{
        fontSize: "13px",
        maxWidth: "600px",
      }}
    >
      {errorsToRender}
      <div style={{ fontSize: "11px", opacity: 0.75 }}>
        NOTE: This error only displays during local development.
      </div>
    </div>
  );
}

export function useErrorToast() {
  const { addToast } = useToast();

  return useCallback(
    (error: (Error | GraphQLError)[]) => {
      const errorId = error
        .map((err) => {
          const message =
            "extensions" in err
              ? (err.extensions?.originalError as any)?.message || err.message
              : err.message;
          const stack = err.stack || "";
          return btoa(message + stack).slice(0, 32); // Create hash from message + stack
        })
        .join("|");

      addToast({
        type: "error",
        id: errorId, // Toast libraries typically dedupe by id
        message: <ErrorToast errors={error} />,
      });
    },
    [addToast],
  );
}

export function useAsyncCallback<T extends (...args: any[]) => Promise<any>>(
  callback: T,
  deps: Parameters<typeof useCallback>[1],
) {
  const addErrorToast = useErrorToast();
  return useCallback(async (...args: Parameters<T>) => {
    try {
      return await callback(...args);
    } catch (error) {
      console.error("Error in async callback:", error);
      // @ts-ignore
      addErrorToast([error]);
      throw error;
    }
  }, deps);
}

/**
 * Shared utility for tracing UI errors across the CopilotKit ecosystem.
 * This function creates a standardized error event and calls the onError handler if available.
 *
 * @param error - The structured CopilotKit error to trace
 * @param originalError - The original error that caused the structured error (optional)
 * @param onError - The error handler function (optional)
 * @param publicApiKey - The public API key (optional)
 * @param operation - The operation name for context (e.g., "loadSuggestions", "useChatCompletion")
 * @param url - The URL for context (optional)
 */
export async function traceUIError(
  error: CopilotKitError,
  originalError?: any,
  onError?: (errorEvent: CopilotErrorEvent) => void | Promise<void>,
  publicApiKey?: string,
  operation: string = "unknown",
  url?: string,
) {
  // Just check if onError and publicApiKey are defined
  if (!onError || !publicApiKey) return;

  try {
    const errorEvent: CopilotErrorEvent = {
      type: "error",
      timestamp: Date.now(),
      context: {
        source: "ui",
        request: {
          operation,
          url: url || "",
          startTime: Date.now(),
        },
        technical: {
          environment: "browser",
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
          stackTrace: originalError instanceof Error ? originalError.stack : undefined,
        },
      },
      error,
    };
    await onError(errorEvent);
  } catch (traceError) {
    console.error(`Error in ${operation} onError handler:`, traceError);
  }
}

/**
 * Shared utility for creating structured CopilotKit errors from GraphQL errors.
 * This function extracts error information from GraphQL error structures and creates
 * appropriate CopilotKit error instances.
 *
 * @param gqlError - The GraphQL error to convert
 * @returns A structured CopilotKit error or null if no structured error can be created
 */
export function createStructuredError(gqlError: GraphQLError): CopilotKitError | null {
  const extensions = gqlError.extensions;
  const originalError = extensions?.originalError as any;

  // Priority: Check stack trace for discovery errors first
  if (originalError?.stack) {
    if (originalError.stack.includes("CopilotApiDiscoveryError")) {
      return new CopilotKitApiDiscoveryError({ message: originalError.message });
    }
    if (originalError.stack.includes("CopilotKitRemoteEndpointDiscoveryError")) {
      return new CopilotKitRemoteEndpointDiscoveryError({ message: originalError.message });
    }
    if (originalError.stack.includes("CopilotKitAgentDiscoveryError")) {
      return new CopilotKitAgentDiscoveryError({
        agentName: "",
        availableAgents: [],
      });
    }
  }

  // Fallback: Use the formal error code if available
  const message = originalError?.message || gqlError.message;
  const code = extensions?.code as CopilotKitErrorCode;

  if (code) {
    return new CopilotKitError({ message, code });
  }

  return null;
}

/**
 * Shared utility for creating structured CopilotKit errors from any error type.
 * This function handles both GraphQL errors and general errors, extracting
 * structured information where available.
 *
 * @param originalError - The original error to convert
 * @returns A structured CopilotKit error
 */
export function createStructuredErrorFromAny(originalError: any): CopilotKitError {
  // Check if it's already a structured error
  if (originalError instanceof CopilotKitError) {
    return originalError;
  }

  // Handle GraphQL errors
  if (originalError?.extensions) {
    const gqlStructuredError = createStructuredError(originalError);
    if (gqlStructuredError) {
      return gqlStructuredError;
    }
  }

  // Extract error information from various error structures
  const extensions = (originalError as any)?.extensions;
  const nestedError = extensions?.originalError;
  const message = nestedError?.message || originalError?.message || String(originalError);
  const code = extensions?.code as CopilotKitErrorCode;

  if (code) {
    return new CopilotKitError({ message, code });
  }

  // Default to unknown error
  return new CopilotKitError({
    message,
    code: CopilotKitErrorCode.UNKNOWN,
  });
}
