export * from "../service-adapters/openai/openai-adapter";
export * from "../service-adapters/langchain/langchain-adapter";
export * from "../service-adapters/google/google-genai-adapter";
export * from "../service-adapters/openai/openai-assistant-adapter";
export * from "../service-adapters/unify/unify-adapter";
export * from "../service-adapters/groq/groq-adapter";
export * from "./integrations";
export * from "./logger";
export * from "./runtime/copilot-runtime";
export * from "./runtime/mcp-tools-utils";
export * from "./runtime/telemetry-agent-runner";

// The below re-exports "dummy" classes and types, to get a deprecation warning redirecting the users to import these from the correct, new route

/**
 * @deprecated LangGraphAgent import from `@copilotkit/runtime` is deprecated. Please import it from `@copilotkit/runtime/langgraph` instead
 */
export class LangGraphAgent {
  constructor() {
    throw new Error(
      "LangGraphAgent import from @copilotkit/runtime is deprecated. Please import it from @copilotkit/runtime/langgraph instead",
    );
  }
}

/**
 * @deprecated LangGraphHttpAgent import from `@copilotkit/runtime` is deprecated. Please import it from `@copilotkit/runtime/langgraph` instead
 */
export class LangGraphHttpAgent {
  constructor() {
    throw new Error(
      "LangGraphHttpAgent import from @copilotkit/runtime is deprecated. Please import it from @copilotkit/runtime/langgraph instead",
    );
  }
}

/**
 * @deprecated TextMessageEvents import from `@copilotkit/runtime` is deprecated. Please import it from `@copilotkit/runtime/langgraph` instead
 */
export type TextMessageEvents = any;
/**
 * @deprecated ToolCallEvents import from `@copilotkit/runtime` is deprecated. Please import it from `@copilotkit/runtime/langgraph` instead
 */
export type ToolCallEvents = any;
/**
 * @deprecated CustomEventNames import from `@copilotkit/runtime` is deprecated. Please import it from `@copilotkit/runtime/langgraph` instead
 */
export type CustomEventNames = any;
/**
 * @deprecated PredictStateTool import from `@copilotkit/runtime` is deprecated. Please import it from `@copilotkit/runtime/langgraph` instead
 */
export type PredictStateTool = any;
