/**
 * Subexport for LangChain-coupled service adapters.
 *
 * Moved here from the `@copilotkit/runtime` root in 1.58.0 so that
 * `@langchain/core` is a genuinely optional peer dependency of the
 * runtime. Consumers importing from the root no longer pull
 * `@langchain/*` into their module graph.
 *
 * v2 will remove this subexport entirely. Migrate to `BuiltInAgent`.
 */
export { LangChainAdapter } from "./service-adapters/langchain/langchain-adapter";
export { BedrockAdapter } from "./service-adapters/bedrock/bedrock-adapter";
export { GoogleGenerativeAIAdapter } from "./service-adapters/google/google-genai-adapter";
export { RemoteChain } from "./service-adapters/langchain/langserve";
export type { RemoteChainParameters } from "./service-adapters/langchain/langserve";
export type { LangChainReturnType } from "./service-adapters/langchain/types";
