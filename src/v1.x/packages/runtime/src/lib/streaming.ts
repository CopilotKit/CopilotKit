import { ReplaySubject } from "rxjs";
import {
  CopilotKitLowLevelError,
  CopilotKitError,
  CopilotKitErrorCode,
  ensureStructuredError,
} from "@copilotkit/shared";
import { errorConfig, getFallbackMessage } from "./error-messages";

export async function writeJsonLineResponseToEventStream<T>(
  response: ReadableStream<Uint8Array>,
  eventStream$: ReplaySubject<T>,
) {
  const reader = response.getReader();
  const decoder = new TextDecoder();
  let buffer = [];

  function flushBuffer() {
    const currentBuffer = buffer.join("");
    if (currentBuffer.trim().length === 0) {
      return;
    }
    const parts = currentBuffer.split("\n");
    if (parts.length === 0) {
      return;
    }

    const lastPartIsComplete = currentBuffer.endsWith("\n");

    // truncate buffer
    buffer = [];

    if (!lastPartIsComplete) {
      // put back the last part
      buffer.push(parts.pop());
    }

    parts
      .map((part) => part.trim())
      .filter((part) => part != "")
      .forEach((part) => {
        eventStream$.next(JSON.parse(part));
      });
  }

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (!done) {
        buffer.push(decoder.decode(value, { stream: true }));
      }

      flushBuffer();

      if (done) {
        break;
      }
    }
  } catch (error) {
    // Preserve already structured CopilotKit errors, only convert unstructured errors
    const structuredError = ensureStructuredError(error, convertStreamingErrorToStructured);
    eventStream$.error(structuredError);
    return;
  }
  eventStream$.complete();
}

function convertStreamingErrorToStructured(error: any): CopilotKitError {
  // Determine a more helpful error message based on context
  let helpfulMessage = generateHelpfulErrorMessage(error);

  // For network-related errors, use CopilotKitLowLevelError to preserve the original error
  if (
    error?.message?.includes("fetch failed") ||
    error?.message?.includes("ECONNREFUSED") ||
    error?.message?.includes("ENOTFOUND") ||
    error?.message?.includes("ETIMEDOUT") ||
    error?.message?.includes("terminated") ||
    error?.cause?.code === "UND_ERR_SOCKET" ||
    error?.message?.includes("other side closed") ||
    error?.code === "UND_ERR_SOCKET"
  ) {
    console.log("error", error);
    return new CopilotKitLowLevelError({
      error: error instanceof Error ? error : new Error(String(error)),
      url: "streaming connection",
      message: helpfulMessage,
    });
  }

  // For all other errors, preserve the raw error in a basic CopilotKitError
  return new CopilotKitError({
    message: helpfulMessage,
    code: CopilotKitErrorCode.UNKNOWN,
  });
}

/**
 * Generates a helpful error message based on error patterns and context
 */
export function generateHelpfulErrorMessage(error: any, context: string = "connection"): string {
  const baseMessage = error?.message || String(error);

  // Check for preserved error information from Python agent
  const originalErrorType = error?.originalErrorType || error?.extensions?.originalErrorType;
  const statusCode = error?.statusCode || error?.extensions?.statusCode;
  const responseData = error?.responseData || error?.extensions?.responseData;

  // First, try to match by original error type if available (more specific)
  if (originalErrorType) {
    const typeConfig = errorConfig.errorPatterns[originalErrorType];
    if (typeConfig) {
      return typeConfig.message.replace("{context}", context);
    }
  }

  // Check for specific error patterns from configuration
  for (const [pattern, config] of Object.entries(errorConfig.errorPatterns)) {
    const shouldMatch =
      baseMessage?.includes(pattern) ||
      error?.cause?.code === pattern ||
      error?.code === pattern ||
      statusCode === parseInt(pattern) ||
      (pattern === "other_side_closed" && baseMessage?.includes("other side closed")) ||
      (pattern === "fetch_failed" && baseMessage?.includes("fetch failed")) ||
      (responseData && JSON.stringify(responseData).includes(pattern));

    if (shouldMatch) {
      // Replace {context} placeholder with actual context
      return config.message.replace("{context}", context);
    }
  }

  // Try to match by category for fallback messages
  if (isNetworkError(error)) {
    return getFallbackMessage("network");
  }

  if (isConnectionError(error)) {
    return getFallbackMessage("connection");
  }

  if (isAuthenticationError(error)) {
    return getFallbackMessage("authentication");
  }

  // Default fallback
  return getFallbackMessage("default");
}

/**
 * Determines if an error is network-related
 */
function isNetworkError(error: any): boolean {
  const networkPatterns = ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "fetch_failed"];
  return networkPatterns.some(
    (pattern) =>
      error?.message?.includes(pattern) ||
      error?.cause?.code === pattern ||
      error?.code === pattern,
  );
}

/**
 * Determines if an error is connection-related
 */
function isConnectionError(error: any): boolean {
  const connectionPatterns = ["terminated", "UND_ERR_SOCKET", "other side closed"];
  return connectionPatterns.some(
    (pattern) =>
      error?.message?.includes(pattern) ||
      error?.cause?.code === pattern ||
      error?.code === pattern,
  );
}

/**
 * Determines if an error is authentication-related
 */
function isAuthenticationError(error: any): boolean {
  const authPatterns = [
    "401",
    "api key",
    "unauthorized",
    "authentication",
    "AuthenticationError",
    "PermissionDeniedError",
  ];
  const baseMessage = error?.message || String(error);
  const originalErrorType = error?.originalErrorType || error?.extensions?.originalErrorType;
  const statusCode = error?.statusCode || error?.extensions?.statusCode;

  return authPatterns.some(
    (pattern) =>
      baseMessage?.toLowerCase().includes(pattern.toLowerCase()) ||
      originalErrorType === pattern ||
      statusCode === 401 ||
      error?.status === 401 ||
      error?.statusCode === 401,
  );
}
