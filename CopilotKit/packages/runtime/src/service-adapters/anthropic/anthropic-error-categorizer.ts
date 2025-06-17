import {
  ErrorCategorizer,
  createLLMProviderError,
  BaseErrorContext,
  CopilotRuntimeError,
} from "../../lib/types/error-types";

/**
 * Anthropic-specific error categorizer that maps Anthropic SDK errors to CopilotRuntimeError types
 */
export class AnthropicErrorCategorizer implements ErrorCategorizer {
  categorizeError(error: unknown, context?: Partial<BaseErrorContext>): CopilotRuntimeError | null {
    // Only handle errors that are from Anthropic SDK
    if (!this.isAnthropicError(error)) {
      return null;
    }

    // Handle specific Anthropic error types
    if (this.isAuthenticationError(error)) {
      return createLLMProviderError("auth_failed", error, {
        ...context,
        provider: "anthropic",
        message: "Anthropic authentication failed. Please check your API key.",
      });
    }

    if (this.isRateLimitError(error)) {
      const retryAfter = this.extractRetryAfter(error);
      return createLLMProviderError("rate_limited", error, {
        ...context,
        provider: "anthropic",
        retryAfter,
        message: `Anthropic rate limit exceeded${retryAfter ? `. Retry after ${retryAfter} seconds` : ""}`,
      });
    }

    if (this.isBadRequestError(error)) {
      // Could be quota exceeded or invalid request
      if (this.isQuotaError(error)) {
        return createLLMProviderError("quota_exceeded", error, {
          ...context,
          provider: "anthropic",
          message: "Anthropic quota exceeded. Please check your billing and usage limits.",
        });
      }
      return createLLMProviderError("invalid_request", error, {
        ...context,
        provider: "anthropic",
      });
    }

    if (this.isNotFoundError(error)) {
      return createLLMProviderError("model_unavailable", error, {
        ...context,
        provider: "anthropic",
        message: "Anthropic model not found or unavailable. Please check your model name.",
      });
    }

    if (this.isInternalServerError(error)) {
      return createLLMProviderError("server_error", error, {
        ...context,
        provider: "anthropic",
        message: "Anthropic server error. Please try again later.",
      });
    }

    if (this.isConnectionError(error)) {
      // Return null so it falls through to network error categorization
      return null;
    }

    // For other Anthropic errors, default to server_error
    return createLLMProviderError("server_error", error, {
      ...context,
      provider: "anthropic",
      message: `Anthropic API error: ${error.message}`,
    });
  }

  private isAnthropicError(error: unknown): error is Error {
    if (!(error instanceof Error)) return false;

    // Check if it's an Anthropic SDK error by constructor name or module
    const errorName = error.constructor.name;
    return (
      errorName.includes("Anthropic") ||
      errorName === "APIError" ||
      errorName === "AuthenticationError" ||
      errorName === "RateLimitError" ||
      errorName === "BadRequestError" ||
      errorName === "NotFoundError" ||
      errorName === "InternalServerError" ||
      errorName === "APIConnectionError" ||
      errorName === "APIConnectionTimeoutError" ||
      errorName === "PermissionDeniedError" ||
      errorName === "UnprocessableEntityError" ||
      errorName === "ConflictError" ||
      // Also check if the error comes from anthropic module
      (error as any)?.constructor?.name?.startsWith?.("Anthropic") ||
      (error as any)?.__module__?.includes?.("anthropic") ||
      (error as any)?.request?.headers?.["anthropic-version"] !== undefined
    );
  }

  private isAuthenticationError(error: Error): boolean {
    return error.constructor.name === "AuthenticationError" || (error as any).status === 401;
  }

  private isRateLimitError(error: Error): boolean {
    return error.constructor.name === "RateLimitError" || (error as any).status === 429;
  }

  private isBadRequestError(error: Error): boolean {
    return error.constructor.name === "BadRequestError" || (error as any).status === 400;
  }

  private isNotFoundError(error: Error): boolean {
    return error.constructor.name === "NotFoundError" || (error as any).status === 404;
  }

  private isInternalServerError(error: Error): boolean {
    return error.constructor.name === "InternalServerError" || (error as any).status === 500;
  }

  private isConnectionError(error: Error): boolean {
    return (
      error.constructor.name === "APIConnectionError" ||
      error.constructor.name === "APIConnectionTimeoutError"
    );
  }

  private isQuotaError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes("quota") ||
      message.includes("billing") ||
      message.includes("credit") ||
      message.includes("usage limit") ||
      message.includes("exceeded your api usage")
    );
  }

  private extractRetryAfter(error: Error): number | undefined {
    // Try to extract retry-after from error headers
    const errorObj = error as any;
    if (errorObj.headers?.["retry-after"]) {
      const retryAfter = parseInt(errorObj.headers["retry-after"], 10);
      return isNaN(retryAfter) ? undefined : retryAfter;
    }

    // Try to extract from error message
    const retryMatch = error.message.match(/retry after (\d+) seconds?/i);
    if (retryMatch) {
      return parseInt(retryMatch[1], 10);
    }

    return undefined;
  }
}
