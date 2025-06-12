import {
  errorCategorizerRegistry,
  categorizeError,
  createLLMProviderError,
  isLLMProviderError,
  ErrorCategorizer,
} from "../error-types";
import { OpenAIErrorCategorizer } from "../../../service-adapters/openai/openai-error-categorizer";
import { AnthropicErrorCategorizer } from "../../../service-adapters/anthropic/anthropic-error-categorizer";

// Mock OpenAI error classes
class MockOpenAIAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
    (this as any).status = 401;
  }
}

class MockOpenAIRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
    (this as any).status = 429;
    (this as any).headers = { "retry-after": "60" };
  }
}

class MockOpenAIBadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
    (this as any).status = 400;
  }
}

// Mock Anthropic error classes
class MockAnthropicAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
    (this as any).status = 401;
    (this as any).request = { headers: { "anthropic-version": "2023-06-01" } };
  }
}

class MockAnthropicRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
    (this as any).status = 429;
    (this as any).request = { headers: { "anthropic-version": "2023-06-01" } };
  }
}

// Mock generic error
class MockGenericError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Error";
  }
}

describe("Error Categorization System", () => {
  beforeEach(() => {
    // Clear the registry to ensure clean tests
    (errorCategorizerRegistry as any).categorizers = [];
  });

  describe("ErrorCategorizer Registry", () => {
    it("should register and use categorizers in order", () => {
      const mockCategorizer1: ErrorCategorizer = {
        categorizeError: jest.fn().mockReturnValue(null),
      };
      const mockCategorizer2: ErrorCategorizer = {
        categorizeError: jest.fn().mockReturnValue({
          category: "llm_provider",
          type: "auth_failed",
          timestamp: Date.now(),
          message: "Test error",
        }),
      };

      errorCategorizerRegistry.register(mockCategorizer1);
      errorCategorizerRegistry.register(mockCategorizer2);

      const error = new Error("Test error");
      const result = categorizeError(error);

      expect(mockCategorizer1.categorizeError).toHaveBeenCalledWith(error, expect.any(Object));
      expect(mockCategorizer2.categorizeError).toHaveBeenCalledWith(error, expect.any(Object));
      expect(result.category).toBe("llm_provider");
      expect(result.type).toBe("auth_failed");
    });

    it("should fall back to generic categorization when no categorizer handles the error", () => {
      const mockCategorizer: ErrorCategorizer = {
        categorizeError: jest.fn().mockReturnValue(null),
      };

      errorCategorizerRegistry.register(mockCategorizer);

      const error = new Error("Network connection failed");
      const result = categorizeError(error);

      expect(mockCategorizer.categorizeError).toHaveBeenCalled();
      expect(result.category).toBe("network");
      expect(result.type).toBe("connection_failed");
    });
  });

  describe("createLLMProviderError helper", () => {
    it("should create properly structured LLM provider errors", () => {
      const originalError = new Error("API key invalid");
      const error = createLLMProviderError("auth_failed", originalError, {
        provider: "openai",
        threadId: "test-thread",
      });

      expect(error.category).toBe("llm_provider");
      expect(error.type).toBe("auth_failed");
      expect(error.provider).toBe("openai");
      expect(error.threadId).toBe("test-thread");
      expect(error.originalError).toBe(originalError);
      expect(error.message).toBe("API key invalid");
      expect(typeof error.timestamp).toBe("number");
    });
  });

  describe("OpenAI Error Categorization", () => {
    beforeEach(() => {
      errorCategorizerRegistry.register(new OpenAIErrorCategorizer());
    });

    it("should categorize OpenAI authentication errors correctly", () => {
      const error = new MockOpenAIAuthenticationError("Invalid API key");
      const result = categorizeError(error);

      expect(isLLMProviderError(result)).toBe(true);
      if (isLLMProviderError(result)) {
        expect(result.type).toBe("auth_failed");
        expect(result.provider).toBe("openai");
        expect(result.message).toBe("OpenAI authentication failed. Please check your API key.");
      }
    });

    it("should categorize OpenAI rate limit errors with retry-after", () => {
      const error = new MockOpenAIRateLimitError("Rate limit exceeded");
      const result = categorizeError(error);

      expect(isLLMProviderError(result)).toBe(true);
      if (isLLMProviderError(result)) {
        expect(result.type).toBe("rate_limited");
        expect(result.provider).toBe("openai");
        expect(result.retryAfter).toBe(60);
        expect(result.message).toContain("Retry after 60 seconds");
      }
    });

    it("should categorize OpenAI quota errors correctly", () => {
      const error = new MockOpenAIBadRequestError("You exceeded your current quota");
      const result = categorizeError(error);

      expect(isLLMProviderError(result)).toBe(true);
      if (isLLMProviderError(result)) {
        expect(result.type).toBe("quota_exceeded");
        expect(result.provider).toBe("openai");
        expect(result.message).toContain("quota exceeded");
      }
    });

    it("should not categorize non-OpenAI errors", () => {
      const error = new MockGenericError("Some random error");
      const result = categorizeError(error);

      // Should fall back to generic categorization
      expect(result.category).toBe("runtime");
      expect(result.type).toBe("internal_error");
    });
  });

  describe("Anthropic Error Categorization", () => {
    beforeEach(() => {
      errorCategorizerRegistry.register(new AnthropicErrorCategorizer());
    });

    it("should categorize Anthropic authentication errors correctly", () => {
      const error = new MockAnthropicAuthenticationError("Invalid API key");
      const result = categorizeError(error);

      expect(isLLMProviderError(result)).toBe(true);
      if (isLLMProviderError(result)) {
        expect(result.type).toBe("auth_failed");
        expect(result.provider).toBe("anthropic");
        expect(result.message).toBe("Anthropic authentication failed. Please check your API key.");
      }
    });

    it("should categorize Anthropic rate limit errors", () => {
      const error = new MockAnthropicRateLimitError("Rate limit exceeded");
      const result = categorizeError(error);

      expect(isLLMProviderError(result)).toBe(true);
      if (isLLMProviderError(result)) {
        expect(result.type).toBe("rate_limited");
        expect(result.provider).toBe("anthropic");
        expect(result.message).toContain("Anthropic rate limit exceeded");
      }
    });

    it("should not categorize non-Anthropic errors", () => {
      const error = new MockGenericError("Some random error");
      const result = categorizeError(error);

      // Should fall back to generic categorization
      expect(result.category).toBe("runtime");
      expect(result.type).toBe("internal_error");
    });
  });

  describe("Provider-specific error handling", () => {
    beforeEach(() => {
      errorCategorizerRegistry.register(new OpenAIErrorCategorizer());
      errorCategorizerRegistry.register(new AnthropicErrorCategorizer());
    });

    it("should correctly route OpenAI errors to OpenAI categorizer", () => {
      const openaiError = new MockOpenAIAuthenticationError("OpenAI auth failed");
      const result = categorizeError(openaiError);

      expect(isLLMProviderError(result)).toBe(true);
      if (isLLMProviderError(result)) {
        expect(result.provider).toBe("openai");
      }
    });

    it("should correctly route Anthropic errors to Anthropic categorizer", () => {
      const anthropicError = new MockAnthropicAuthenticationError("Anthropic auth failed");
      const result = categorizeError(anthropicError);

      expect(isLLMProviderError(result)).toBe(true);
      if (isLLMProviderError(result)) {
        expect(result.provider).toBe("anthropic");
      }
    });

    it("should handle multiple provider errors in the same session", () => {
      const openaiError = new MockOpenAIRateLimitError("OpenAI rate limited");
      const anthropicError = new MockAnthropicRateLimitError("Anthropic rate limited");

      const openaiResult = categorizeError(openaiError);
      const anthropicResult = categorizeError(anthropicError);

      expect(isLLMProviderError(openaiResult)).toBe(true);
      expect(isLLMProviderError(anthropicResult)).toBe(true);

      if (isLLMProviderError(openaiResult) && isLLMProviderError(anthropicResult)) {
        expect(openaiResult.provider).toBe("openai");
        expect(anthropicResult.provider).toBe("anthropic");
        expect(openaiResult.type).toBe("rate_limited");
        expect(anthropicResult.type).toBe("rate_limited");
      }
    });
  });

  describe("Fallback categorization", () => {
    it("should categorize network errors correctly", () => {
      const error = new Error("fetch failed");
      const result = categorizeError(error);

      expect(result.category).toBe("network");
      expect(result.type).toBe("connection_failed");
    });

    it("should categorize timeout errors correctly", () => {
      const error = new Error("Request timeout");
      const result = categorizeError(error);

      expect(result.category).toBe("network");
      expect(result.type).toBe("timeout");
    });

    it("should categorize CORS errors correctly", () => {
      const error = new Error("CORS policy blocked request");
      const result = categorizeError(error);

      expect(result.category).toBe("security");
      expect(result.type).toBe("cors_error");
    });

    it("should default to runtime error for unknown errors", () => {
      const error = new Error("Some unknown error");
      const result = categorizeError(error);

      expect(result.category).toBe("runtime");
      expect(result.type).toBe("internal_error");
    });
  });
});
