import {
  categorizeError,
  isLLMProviderError,
  isNetworkError,
  isRuntimeError,
  isAgentError,
  errorCategorizerRegistry,
} from "../error-types";

describe("Error Types", () => {
  beforeEach(() => {
    // Clear the registry to ensure clean tests - no LLM provider categorizers registered
    (errorCategorizerRegistry as any).categorizers = [];
  });

  describe("categorizeError", () => {
    it("should categorize LLM auth errors correctly with fallback (no provider categorizers)", () => {
      const error = new Error("unauthorized access - invalid api key");
      const categorized = categorizeError(error);

      // With no LLM provider categorizers registered, this should fall back to runtime error
      expect(categorized.category).toBe("runtime");
      expect(categorized.type).toBe("internal_error");
      expect(categorized.originalError).toBe(error);
    });

    it("should categorize quota errors correctly with fallback (no provider categorizers)", () => {
      const error = new Error("quota exceeded for this API key");
      const categorized = categorizeError(error);

      // With no LLM provider categorizers registered, this should fall back to runtime error
      expect(categorized.category).toBe("runtime");
      expect(categorized.type).toBe("internal_error");
    });

    it("should categorize timeout errors correctly", () => {
      const error = new Error("request timeout after 30 seconds");
      const categorized = categorizeError(error);

      expect(categorized.category).toBe("network");
      expect(categorized.type).toBe("timeout");
    });

    it("should categorize network errors correctly", () => {
      const error = new Error("fetch failed due to network error");
      const categorized = categorizeError(error);

      expect(categorized.category).toBe("network");
      expect(categorized.type).toBe("connection_failed");
    });

    it("should categorize CORS errors correctly", () => {
      const error = new Error("blocked by CORS policy");
      const categorized = categorizeError(error);

      expect(categorized.category).toBe("security");
      expect(categorized.type).toBe("cors_error");
    });

    it("should default to runtime error for unknown errors", () => {
      const error = new Error("some unknown error");
      const categorized = categorizeError(error);

      expect(categorized.category).toBe("runtime");
      expect(categorized.type).toBe("internal_error");
    });
  });

  describe("type guards", () => {
    it("should correctly identify LLM provider errors", () => {
      const error = {
        category: "llm_provider" as const,
        type: "auth_failed" as const,
        message: "test error",
        timestamp: Date.now(),
      };

      expect(isLLMProviderError(error)).toBe(true);
      expect(isNetworkError(error)).toBe(false);
      expect(isRuntimeError(error)).toBe(false);
      expect(isAgentError(error)).toBe(false);
    });

    it("should correctly identify network errors", () => {
      const error = {
        category: "network" as const,
        type: "connection_failed" as const,
        message: "test error",
        timestamp: Date.now(),
      };

      expect(isNetworkError(error)).toBe(true);
      expect(isLLMProviderError(error)).toBe(false);
      expect(isRuntimeError(error)).toBe(false);
      expect(isAgentError(error)).toBe(false);
    });

    it("should correctly identify runtime errors", () => {
      const error = {
        category: "runtime" as const,
        type: "internal_error" as const,
        message: "test error",
        timestamp: Date.now(),
      };

      expect(isRuntimeError(error)).toBe(true);
      expect(isLLMProviderError(error)).toBe(false);
      expect(isNetworkError(error)).toBe(false);
      expect(isAgentError(error)).toBe(false);
    });

    it("should correctly identify agent errors", () => {
      const error = {
        category: "agent" as const,
        type: "execution_failed" as const,
        message: "test error",
        timestamp: Date.now(),
      };

      expect(isAgentError(error)).toBe(true);
      expect(isLLMProviderError(error)).toBe(false);
      expect(isNetworkError(error)).toBe(false);
      expect(isRuntimeError(error)).toBe(false);
    });
  });
});
