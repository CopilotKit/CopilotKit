/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — CustomEventNames:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — LangGraphAgent:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — LangGraphHttpAgent:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — PredictStateTool:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — TextMessageEvents:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — ToolCallEvents:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

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
