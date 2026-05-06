export type {
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
  CopilotServiceAdapter,
} from "./service-adapter";
export * from "./shared";
export * from "./openai/openai-adapter";
export * from "./openai/openai-assistant-adapter";
export * from "./unify/unify-adapter";
export * from "./groq/groq-adapter";
export * from "./anthropic/anthropic-adapter";
export * from "./experimental/ollama/ollama-adapter";
export * from "./empty/empty-adapter";

// LangChain-coupled adapters moved to @copilotkit/runtime/langchain in 1.58.0.
// Re-export the throw-on-construction shims so existing imports of these
// symbols from `@copilotkit/runtime` resolve at the type level but throw on
// construction with a pointer at the new subexport path. Importing nothing
// from @langchain/* here keeps the root barrel's module graph clean (verified
// by scripts/smoke-no-langchain.mjs).
export {
  LangChainAdapter,
  BedrockAdapter,
  GoogleGenerativeAIAdapter,
  RemoteChain,
} from "./langchain-deprecated-shims";
export type {
  RemoteChainParameters,
  LangChainReturnType,
} from "./langchain-deprecated-shims";
