export * from "../service-adapters/openai/openai-adapter";
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

// LangChain-coupled adapters moved to @copilotkit/runtime/langchain in 1.58.0.
// Importing these from the runtime root throws on construction, with a pointer
// at the new subexport plus a one-line codemod. v2 removes them entirely.

const langchainSubexportMessage = (symbol: string) =>
  `'${symbol}' is no longer exported from '@copilotkit/runtime'. ` +
  `Import it from '@copilotkit/runtime/langchain' instead.\n` +
  `Run the codemod:\n` +
  `  npx jscodeshift -t https://raw.githubusercontent.com/CopilotKit/CopilotKit/main/codemods/langchain-subexport.cjs --parser=tsx <paths>\n` +
  `Note: LangChain adapters will be removed entirely in v2 — migrate to BuiltInAgent.`;

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export class LangChainAdapter {
  constructor() {
    throw new Error(langchainSubexportMessage("LangChainAdapter"));
  }
}

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export class BedrockAdapter {
  constructor() {
    throw new Error(langchainSubexportMessage("BedrockAdapter"));
  }
}

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export class GoogleGenerativeAIAdapter {
  constructor() {
    throw new Error(langchainSubexportMessage("GoogleGenerativeAIAdapter"));
  }
}

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export class RemoteChain {
  constructor() {
    throw new Error(langchainSubexportMessage("RemoteChain"));
  }
}

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export type RemoteChainParameters = any;

/**
 * @deprecated Import from `@copilotkit/runtime/langchain` instead. Removed in v2.
 */
export type LangChainReturnType = any;
