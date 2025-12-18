/**
 * Error message configuration - Single source of truth for all error messages
 *
 * This centralized configuration system provides:
 *
 * 🎯 **Benefits:**
 * - Single source of truth for all error messages
 * - Easy content management without touching code
 * - Consistent error messaging across the application
 * - Ready for internationalization (i18n)
 * - Type-safe configuration with TypeScript
 * - Categorized errors for better handling
 *
 * 📝 **How to use:**
 * 1. Add new error patterns to `errorPatterns` object
 * 2. Use {context} placeholder for dynamic context injection
 * 3. Specify category, severity, and actionable flags
 * 4. Add fallback messages for error categories
 *
 * 🔧 **How to maintain:**
 * - Content teams can update messages here without touching logic
 * - Developers add new error patterns as needed
 * - Use categories to group similar errors
 * - Mark errors as actionable if users can fix them
 *
 * 🌍 **Future i18n support:**
 * - Replace `message` string with `messages: { en: "...", es: "..." }`
 * - Add locale parameter to helper functions
 *
 * @example
 * ```typescript
 * // Adding a new error pattern:
 * "CUSTOM_ERROR": {
 *   message: "Custom error occurred in {context}. Please try again.",
 *   category: "unknown",
 *   severity: "error",
 *   actionable: true
 * }
 * ```
 */

export interface ErrorPatternConfig {
  message: string;
  category: "network" | "connection" | "authentication" | "validation" | "unknown";
  severity: "error" | "warning" | "info";
  actionable: boolean;
}

export interface ErrorConfig {
  errorPatterns: Record<string, ErrorPatternConfig>;
  fallbacks: Record<string, string>;
  contextTemplates: Record<string, string>;
}

export const errorConfig: ErrorConfig = {
  errorPatterns: {
    ECONNREFUSED: {
      message:
        "Connection refused - the agent service is not running or not accessible at the specified address. Please check that your agent is started and listening on the correct port.",
      category: "network",
      severity: "error",
      actionable: true,
    },
    ENOTFOUND: {
      message:
        "Host not found - the agent service URL appears to be incorrect or the service is not accessible. Please verify the agent endpoint URL.",
      category: "network",
      severity: "error",
      actionable: true,
    },
    ETIMEDOUT: {
      message:
        "Connection timeout - the agent service is taking too long to respond. This could indicate network issues or an overloaded agent service.",
      category: "network",
      severity: "warning",
      actionable: true,
    },
    terminated: {
      message:
        "Agent {context} was unexpectedly terminated. This often indicates an error in the agent service (e.g., authentication failures, missing environment variables, or agent crashes). Check the agent logs for the root cause.",
      category: "connection",
      severity: "error",
      actionable: true,
    },
    UND_ERR_SOCKET: {
      message:
        "Socket connection was closed unexpectedly. This typically indicates the agent service encountered an error and shut down the connection. Check the agent logs for the underlying cause.",
      category: "connection",
      severity: "error",
      actionable: true,
    },
    other_side_closed: {
      message:
        "The agent service closed the connection unexpectedly. This usually indicates an error in the agent service. Check the agent logs for more details.",
      category: "connection",
      severity: "error",
      actionable: true,
    },
    fetch_failed: {
      message:
        "Failed to connect to the agent service. Please verify the agent is running and the endpoint URL is correct.",
      category: "network",
      severity: "error",
      actionable: true,
    },
    // Authentication patterns
    "401": {
      message:
        "Authentication failed. Please check your API keys and ensure they are correctly configured.",
      category: "authentication",
      severity: "error",
      actionable: true,
    },
    "api key": {
      message:
        "API key error detected. Please verify your API key is correct and has the necessary permissions.",
      category: "authentication",
      severity: "error",
      actionable: true,
    },
    unauthorized: {
      message: "Unauthorized access. Please check your authentication credentials.",
      category: "authentication",
      severity: "error",
      actionable: true,
    },
    // Python-specific error patterns
    AuthenticationError: {
      message:
        "OpenAI authentication failed. Please check your OPENAI_API_KEY environment variable or API key configuration.",
      category: "authentication",
      severity: "error",
      actionable: true,
    },
    "Incorrect API key provided": {
      message:
        "OpenAI API key is invalid. Please verify your OPENAI_API_KEY is correct and active.",
      category: "authentication",
      severity: "error",
      actionable: true,
    },
    RateLimitError: {
      message:
        "OpenAI rate limit exceeded. Please wait a moment and try again, or check your OpenAI usage limits.",
      category: "network",
      severity: "warning",
      actionable: true,
    },
    InvalidRequestError: {
      message:
        "Invalid request to OpenAI API. Please check your request parameters and model configuration.",
      category: "validation",
      severity: "error",
      actionable: true,
    },
    PermissionDeniedError: {
      message:
        "Permission denied for OpenAI API. Please check your API key permissions and billing status.",
      category: "authentication",
      severity: "error",
      actionable: true,
    },
    NotFoundError: {
      message: "OpenAI resource not found. Please check your model name and availability.",
      category: "validation",
      severity: "error",
      actionable: true,
    },
  },
  fallbacks: {
    network:
      "A network error occurred while connecting to the agent service. Please check your connection and ensure the agent service is running.",
    connection:
      "The connection to the agent service was lost unexpectedly. This may indicate an issue with the agent service.",
    authentication: "Authentication failed. Please check your API keys and credentials.",
    validation: "Invalid input or configuration. Please check your parameters and try again.",
    unknown: "An unexpected error occurred. Please check the logs for more details.",
    default: "An unexpected error occurred. Please check the logs for more details.",
  },
  contextTemplates: {
    connection: "connection",
    event_streaming_connection: "event streaming connection",
    agent_streaming_connection: "agent streaming connection",
    langgraph_agent_connection: "LangGraph agent connection",
  },
};

/**
 * Helper function to get error pattern configuration by key
 */
export function getErrorPattern(key: string): ErrorPatternConfig | undefined {
  return errorConfig.errorPatterns[key];
}

/**
 * Helper function to get fallback message by category
 */
export function getFallbackMessage(category: string): string {
  return errorConfig.fallbacks[category] || errorConfig.fallbacks.default;
}
