import {
  ErrorCategorizer,
  createLLMProviderError,
  BaseErrorContext,
  CopilotRuntimeError,
} from "../../lib/types/error-types";

/**
 * OpenAI-specific error categorizer that maps OpenAI SDK errors to CopilotRuntimeError types
 */
export class OpenAIErrorCategorizer implements ErrorCategorizer {
  categorizeError(error: unknown, context?: Partial<BaseErrorContext>): CopilotRuntimeError | null {
    // Only handle errors that are from OpenAI SDK
    if (!this.isOpenAIError(error)) {
      return null;
    }

    // Handle specific OpenAI error types
    if (this.isAuthenticationError(error)) {
      return createLLMProviderError("auth_failed", error, {
        ...context,
        provider: "openai",
        message: "OpenAI authentication failed. Please check your API key.",
      });
    }

    if (this.isRateLimitError(error)) {
      // Extract retry-after header if available
      const retryAfter = this.extractRetryAfter(error);
      return createLLMProviderError("rate_limited", error, {
        ...context,
        provider: "openai",
        retryAfter,
        message: `OpenAI rate limit exceeded${retryAfter ? `. Retry after ${retryAfter} seconds` : ""}`,
      });
    }

    if (this.isBadRequestError(error)) {
      // Could be quota exceeded or invalid request
      if (this.isQuotaError(error)) {
        return createLLMProviderError("quota_exceeded", error, {
          ...context,
          provider: "openai",
          message: "OpenAI quota exceeded. Please check your billing and usage limits.",
        });
      }
      return createLLMProviderError("invalid_request", error, {
        ...context,
        provider: "openai",
      });
    }

    if (this.isNotFoundError(error)) {
      return createLLMProviderError("model_unavailable", error, {
        ...context,
        provider: "openai",
        message: "OpenAI model not found or unavailable. Please check your model name.",
      });
    }

    if (this.isInternalServerError(error)) {
      return createLLMProviderError("server_error", error, {
        ...context,
        provider: "openai",
        message: "OpenAI server error. Please try again later.",
      });
    }

    if (this.isConnectionError(error)) {
      // Return null so it falls through to network error categorization
      return null;
    }

    // For other OpenAI errors, default to server_error
    return createLLMProviderError("server_error", error, {
      ...context,
      provider: "openai",
      message: `OpenAI API error: ${error.message}`,
    });
  }

  private isOpenAIError(error: unknown): error is Error {
    if (!(error instanceof Error)) return false;

    // Check if it's an OpenAI SDK error by constructor name or module
    const errorName = error.constructor.name;
    return (
      errorName.includes("OpenAI") ||
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
      // Also check if the error comes from openai module
      (error as any)?.constructor?.name?.startsWith?.("OpenAI") ||
      (error as any)?.__module__?.includes?.("openai")
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
      message.includes("insufficient_quota") ||
      message.includes("exceeded your current quota")
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
