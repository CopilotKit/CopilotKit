export { type OpenAIAdapterParams, OpenAIAdapter } from "../service-adapters/openai/openai-adapter";
export { LangChainAdapter } from "../service-adapters/langchain/langchain-adapter";
export { GoogleGenerativeAIAdapter } from "../service-adapters/google/google-genai-adapter";
export {
  type OpenAIAssistantAdapterParams,
  OpenAIAssistantAdapter,
} from "../service-adapters/openai/openai-assistant-adapter";
export { type UnifyAdapterParams, UnifyAdapter } from "../service-adapters/unify/unify-adapter";
export { type GroqAdapterParams, GroqAdapter } from "../service-adapters/groq/groq-adapter";

export {
  type CopilotEndpointCorsConfig,
  type CopilotRequestContextProperties,
  type GraphQLContext,
  type CreateCopilotRuntimeServerOptions,
  buildSchema,
  type CommonConfig,
  getCommonConfig,
  copilotRuntimeNextJSAppRouterEndpoint,
  config,
  copilotRuntimeNextJSPagesRouterEndpoint,
  copilotRuntimeNodeHttpEndpoint,
  copilotRuntimeNodeExpressEndpoint,
  copilotRuntimeNestEndpoint,
} from "./integrations";

export { type LogLevel, type CopilotRuntimeLogger, createLogger } from "./logger";

export {
  type CopilotRuntimeConstructorParams_BASE,
  CopilotRuntime,
  copilotKitEndpoint,
  langGraphPlatformEndpoint,
  resolveEndpointType,
} from "./runtime/copilot-runtime";

export {
  type MCPTool,
  type MCPClient,
  type MCPEndpointConfig,
  extractParametersFromSchema,
  convertMCPToolsToActions,
  generateMcpToolInstructions,
} from "./runtime/mcp-tools-utils";

export {
  type TelemetryAgentRunnerConfig,
  TelemetryAgentRunner,
} from "./runtime/telemetry-agent-runner";

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
