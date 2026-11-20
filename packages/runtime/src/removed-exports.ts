// GENERATED FILE — DO NOT EDIT BY HAND.
// Regenerate with: pnpm exec tsx scripts/deprecations/removed-exports.mts generate
//
// Stand-ins for the CopilotKit 1.x exports that 2.0 removed from @copilotkit/runtime.
// Calling, constructing, or rendering one throws a CopilotKitRemovedApiError,
// and importing one does not. TypeScript fails on the same code with the same
// message. The replacements are in packages/shared/src/removed-exports-table.ts.

import { removedApi } from "@copilotkit/shared";
import type { RemovedType } from "@copilotkit/shared";

/** @deprecated "AnthropicAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const AnthropicAdapter = /*#__PURE__*/ removedApi({
  name: "AnthropicAdapter",
  use: 'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "AnthropicAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type AnthropicAdapter = typeof AnthropicAdapter;

/** @deprecated "AnthropicAdapterParams" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type AnthropicAdapterParams = RemovedType<
  "AnthropicAdapterParams",
  'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "AnthropicPromptCachingConfig" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type AnthropicPromptCachingConfig = RemovedType<
  "AnthropicPromptCachingConfig",
  'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "BasicAgent" was removed in CopilotKit 2.0. Use BuiltInAgent from @copilotkit/runtime/agent. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/removed-apis-2.0#runtime */
export const BasicAgent = /*#__PURE__*/ removedApi({
  name: "BasicAgent",
  use: "Use BuiltInAgent from @copilotkit/runtime/agent.",
  docs: "/migrate/removed-apis-2.0#runtime",
});
/** @deprecated "BasicAgent" was removed in CopilotKit 2.0. Use BuiltInAgent from @copilotkit/runtime/agent. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/removed-apis-2.0#runtime */
export type BasicAgent = typeof BasicAgent;

/** @deprecated "BasicAgentConfiguration" was removed in CopilotKit 2.0. Use BuiltInAgentClassicConfig from @copilotkit/runtime/agent. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/removed-apis-2.0#runtime */
export type BasicAgentConfiguration = RemovedType<
  "BasicAgentConfiguration",
  "Use BuiltInAgentClassicConfig from @copilotkit/runtime/agent.",
  "/migrate/removed-apis-2.0#runtime"
>;

/** @deprecated "BedrockAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const BedrockAdapter = /*#__PURE__*/ removedApi({
  name: "BedrockAdapter",
  use: 'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "BedrockAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type BedrockAdapter = typeof BedrockAdapter;

/** @deprecated "BedrockAdapterParams" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type BedrockAdapterParams = RemovedType<
  "BedrockAdapterParams",
  'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "buildSchema" was removed in CopilotKit 2.0. CopilotKit 2.0 has no GraphQL endpoint. Serve the runtime with createCopilotKitRuntimeHandler from @copilotkit/runtime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const buildSchema = /*#__PURE__*/ removedApi({
  name: "buildSchema",
  use: "CopilotKit 2.0 has no GraphQL endpoint. Serve the runtime with createCopilotKitRuntimeHandler from @copilotkit/runtime.",
  docs: "/migrate/v2#update-the-runtime",
});

/** @deprecated "BuiltInAgentModel" was removed in CopilotKit 2.0. Use AnyTextAdapter from @tanstack/ai: the model of a BuiltInAgent is a TanStack AI text adapter. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */
export type BuiltInAgentModel = RemovedType<
  "BuiltInAgentModel",
  "Use AnyTextAdapter from @tanstack/ai: the model of a BuiltInAgent is a TanStack AI text adapter.",
  "/migrate/runtime-2.0#built-in-agent"
>;

/** @deprecated "classifyModelSpec" was removed in CopilotKit 2.0. Pass an adapter as model, for example anthropicText("claude-sonnet-4-6"). To switch models from the frontend, set the resolveModel option of the BuiltInAgent. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#if-you-used-resolvemodel-or-classifymodelspec */
export const classifyModelSpec = /*#__PURE__*/ removedApi({
  name: "classifyModelSpec",
  use: 'Pass an adapter as model, for example anthropicText("claude-sonnet-4-6"). To switch models from the frontend, set the resolveModel option of the BuiltInAgent.',
  docs: "/migrate/runtime-2.0#if-you-used-resolvemodel-or-classifymodelspec",
});

/** @deprecated "CommonConfig" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type CommonConfig = RemovedType<
  "CommonConfig",
  'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "convertJsonSchemaToZodSchema" was removed in CopilotKit 2.0. 2.0 exports the AI SDK helpers from @copilotkit/runtime/agent/ai-sdk. Import it from there, and add the ai package to your app. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */
export const convertJsonSchemaToZodSchema = /*#__PURE__*/ removedApi({
  name: "convertJsonSchemaToZodSchema",
  use: "2.0 exports the AI SDK helpers from @copilotkit/runtime/agent/ai-sdk. Import it from there, and add the ai package to your app.",
  docs: "/migrate/runtime-2.0#built-in-agent",
});

/** @deprecated "convertMCPToolsToActions" was removed in CopilotKit 2.0. Create the MCP client with createMCPClient from @tanstack/ai-mcp, and pass it to a BuiltInAgent as mcp: { clients: [client] }. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#4-replace-mcpservers-with-mcp */
export const convertMCPToolsToActions = /*#__PURE__*/ removedApi({
  name: "convertMCPToolsToActions",
  use: "Create the MCP client with createMCPClient from @tanstack/ai-mcp, and pass it to a BuiltInAgent as mcp: { clients: [client] }.",
  docs: "/migrate/runtime-2.0#4-replace-mcpservers-with-mcp",
});

/** @deprecated "convertMessagesToVercelAISDKMessages" was removed in CopilotKit 2.0. 2.0 exports the AI SDK helpers from @copilotkit/runtime/agent/ai-sdk. Import it from there, and add the ai package to your app. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */
export const convertMessagesToVercelAISDKMessages = /*#__PURE__*/ removedApi({
  name: "convertMessagesToVercelAISDKMessages",
  use: "2.0 exports the AI SDK helpers from @copilotkit/runtime/agent/ai-sdk. Import it from there, and add the ai package to your app.",
  docs: "/migrate/runtime-2.0#built-in-agent",
});

/** @deprecated "convertServiceAdapterError" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const convertServiceAdapterError = /*#__PURE__*/ removedApi({
  name: "convertServiceAdapterError",
  use: 'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  docs: "/migrate/v2#update-the-runtime",
});

/** @deprecated "convertToolDefinitionsToVercelAITools" was removed in CopilotKit 2.0. 2.0 exports the AI SDK helpers from @copilotkit/runtime/agent/ai-sdk. Import it from there, and add the ai package to your app. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */
export const convertToolDefinitionsToVercelAITools = /*#__PURE__*/ removedApi({
  name: "convertToolDefinitionsToVercelAITools",
  use: "2.0 exports the AI SDK helpers from @copilotkit/runtime/agent/ai-sdk. Import it from there, and add the ai package to your app.",
  docs: "/migrate/runtime-2.0#built-in-agent",
});

/** @deprecated "convertToolsToVercelAITools" was removed in CopilotKit 2.0. 2.0 exports the AI SDK helpers from @copilotkit/runtime/agent/ai-sdk. Import it from there, and add the ai package to your app. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */
export const convertToolsToVercelAITools = /*#__PURE__*/ removedApi({
  name: "convertToolsToVercelAITools",
  use: "2.0 exports the AI SDK helpers from @copilotkit/runtime/agent/ai-sdk. Import it from there, and add the ai package to your app.",
  docs: "/migrate/runtime-2.0#built-in-agent",
});

/** @deprecated "CopilotEndpointCorsConfig" was removed in CopilotKit 2.0. Use CopilotKitCorsConfig from @copilotkit/runtime, the cors option of createCopilotKitRuntimeHandler. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#cors-and-lifecycle */
export type CopilotEndpointCorsConfig = RemovedType<
  "CopilotEndpointCorsConfig",
  "Use CopilotKitCorsConfig from @copilotkit/runtime, the cors option of createCopilotKitRuntimeHandler.",
  "/migrate/runtime-2.0#cors-and-lifecycle"
>;

/** @deprecated "CopilotExpressEndpointParams" was removed in CopilotKit 2.0. Mount createCopilotKitNodeListener from @copilotkit/runtime/node in your Express app. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#node-and-express */
export type CopilotExpressEndpointParams = RemovedType<
  "CopilotExpressEndpointParams",
  "Mount createCopilotKitNodeListener from @copilotkit/runtime/node in your Express app.",
  "/migrate/runtime-2.0#node-and-express"
>;

/** @deprecated "CopilotExpressRouter" was removed in CopilotKit 2.0. Mount createCopilotKitNodeListener from @copilotkit/runtime/node in your Express app. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#node-and-express */
export type CopilotExpressRouter = RemovedType<
  "CopilotExpressRouter",
  "Mount createCopilotKitNodeListener from @copilotkit/runtime/node in your Express app.",
  "/migrate/runtime-2.0#node-and-express"
>;

/** @deprecated "CopilotHonoApp" was removed in CopilotKit 2.0. Use createCopilotKitRuntimeHandler from @copilotkit/runtime. In Hono, pass it c.req.raw. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#fetch-and-nextjs */
export type CopilotHonoApp = RemovedType<
  "CopilotHonoApp",
  "Use createCopilotKitRuntimeHandler from @copilotkit/runtime. In Hono, pass it c.req.raw.",
  "/migrate/runtime-2.0#fetch-and-nextjs"
>;

/** @deprecated "copilotKitEndpoint" was removed in CopilotKit 2.0. CopilotKitRuntime has no remoteEndpoints. Serve each Python agent over AG-UI, and register it in agents. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/agents-2.0#python-sdk-endpoint */
export const copilotKitEndpoint = /*#__PURE__*/ removedApi({
  name: "copilotKitEndpoint",
  use: "CopilotKitRuntime has no remoteEndpoints. Serve each Python agent over AG-UI, and register it in agents.",
  docs: "/migrate/agents-2.0#python-sdk-endpoint",
});

/** @deprecated "CopilotKitRequestHandler" was removed in CopilotKit 2.0. Use CopilotKitRuntimeFetchHandler from @copilotkit/runtime. It takes the Request directly. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/removed-apis-2.0#runtime */
export type CopilotKitRequestHandler = RemovedType<
  "CopilotKitRequestHandler",
  "Use CopilotKitRuntimeFetchHandler from @copilotkit/runtime. It takes the Request directly.",
  "/migrate/removed-apis-2.0#runtime"
>;

/** @deprecated "CopilotRequestContextProperties" was removed in CopilotKit 2.0. CopilotKit 2.0 has no GraphQL endpoint. Read the request in the hooks option of createCopilotKitRuntimeHandler (CopilotKitRuntimeHooks from @copilotkit/runtime). Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type CopilotRequestContextProperties = RemovedType<
  "CopilotRequestContextProperties",
  "CopilotKit 2.0 has no GraphQL endpoint. Read the request in the hooks option of createCopilotKitRuntimeHandler (CopilotKitRuntimeHooks from @copilotkit/runtime).",
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "CopilotRuntime" was removed in CopilotKit 2.0. Use CopilotKitRuntime from @copilotkit/runtime, and pass each agent in agents. A model runs in a BuiltInAgent from @copilotkit/runtime/agent, so serviceAdapter, remoteEndpoints, and actions are gone. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const CopilotRuntime = /*#__PURE__*/ removedApi({
  name: "CopilotRuntime",
  use: "Use CopilotKitRuntime from @copilotkit/runtime, and pass each agent in agents. A model runs in a BuiltInAgent from @copilotkit/runtime/agent, so serviceAdapter, remoteEndpoints, and actions are gone.",
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "CopilotRuntime" was removed in CopilotKit 2.0. Use CopilotKitRuntime from @copilotkit/runtime, and pass each agent in agents. A model runs in a BuiltInAgent from @copilotkit/runtime/agent, so serviceAdapter, remoteEndpoints, and actions are gone. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type CopilotRuntime<_T1 = unknown> = typeof CopilotRuntime;

/** @deprecated "CopilotRuntimeChatCompletionRequest" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type CopilotRuntimeChatCompletionRequest = RemovedType<
  "CopilotRuntimeChatCompletionRequest",
  'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "CopilotRuntimeChatCompletionResponse" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type CopilotRuntimeChatCompletionResponse = RemovedType<
  "CopilotRuntimeChatCompletionResponse",
  'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "CopilotRuntimeConstructorParams_BASE" was removed in CopilotKit 2.0. Use CopilotKitRuntimeOptions from @copilotkit/runtime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type CopilotRuntimeConstructorParams_BASE<_T1 = unknown> = RemovedType<
  "CopilotRuntimeConstructorParams_BASE",
  "Use CopilotKitRuntimeOptions from @copilotkit/runtime.",
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "CopilotRuntimeLogger" was removed in CopilotKit 2.0. Use CopilotKitRuntimeLogger from @copilotkit/runtime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#renamed-runtime-exports */
export type CopilotRuntimeLogger = RemovedType<
  "CopilotRuntimeLogger",
  "Use CopilotKitRuntimeLogger from @copilotkit/runtime.",
  "/migrate/runtime-2.0#renamed-runtime-exports"
>;

/** @deprecated "copilotRuntimeNestEndpoint" was removed in CopilotKit 2.0. Mount createCopilotKitNodeListener from @copilotkit/runtime/node in your Express app. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#node-and-express */
export const copilotRuntimeNestEndpoint = /*#__PURE__*/ removedApi({
  name: "copilotRuntimeNestEndpoint",
  use: "Mount createCopilotKitNodeListener from @copilotkit/runtime/node in your Express app.",
  docs: "/migrate/runtime-2.0#node-and-express",
});

/** @deprecated "copilotRuntimeNextJSAppRouterEndpoint" was removed in CopilotKit 2.0. Serve the runtime with createCopilotKitRuntimeHandler from @copilotkit/runtime, and export the handler as GET and POST from app/api/copilotkit/[[...slug]]/route.ts. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#fetch-and-nextjs */
export const copilotRuntimeNextJSAppRouterEndpoint = /*#__PURE__*/ removedApi({
  name: "copilotRuntimeNextJSAppRouterEndpoint",
  use: "Serve the runtime with createCopilotKitRuntimeHandler from @copilotkit/runtime, and export the handler as GET and POST from app/api/copilotkit/[[...slug]]/route.ts.",
  docs: "/migrate/runtime-2.0#fetch-and-nextjs",
});

/** @deprecated "copilotRuntimeNextJSPagesRouterEndpoint" was removed in CopilotKit 2.0. Serve the runtime with createCopilotKitNodeHandler from @copilotkit/runtime/node. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#node-and-express */
export const copilotRuntimeNextJSPagesRouterEndpoint = /*#__PURE__*/ removedApi(
  {
    name: "copilotRuntimeNextJSPagesRouterEndpoint",
    use: "Serve the runtime with createCopilotKitNodeHandler from @copilotkit/runtime/node.",
    docs: "/migrate/runtime-2.0#node-and-express",
  },
);

/** @deprecated "copilotRuntimeNodeExpressEndpoint" was removed in CopilotKit 2.0. Mount createCopilotKitNodeListener from @copilotkit/runtime/node in your Express app. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#node-and-express */
export const copilotRuntimeNodeExpressEndpoint = /*#__PURE__*/ removedApi({
  name: "copilotRuntimeNodeExpressEndpoint",
  use: "Mount createCopilotKitNodeListener from @copilotkit/runtime/node in your Express app.",
  docs: "/migrate/runtime-2.0#node-and-express",
});

/** @deprecated "copilotRuntimeNodeHttpEndpoint" was removed in CopilotKit 2.0. Serve the runtime with createCopilotKitNodeListener from @copilotkit/runtime/node. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#node-and-express */
export const copilotRuntimeNodeHttpEndpoint = /*#__PURE__*/ removedApi({
  name: "copilotRuntimeNodeHttpEndpoint",
  use: "Serve the runtime with createCopilotKitNodeListener from @copilotkit/runtime/node.",
  docs: "/migrate/runtime-2.0#node-and-express",
});

/** @deprecated "CopilotServiceAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type CopilotServiceAdapter = RemovedType<
  "CopilotServiceAdapter",
  'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "createCopilotEndpoint" was removed in CopilotKit 2.0. Use createCopilotKitRuntimeHandler from @copilotkit/runtime. In Hono, pass it c.req.raw. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#fetch-and-nextjs */
export const createCopilotEndpoint = /*#__PURE__*/ removedApi({
  name: "createCopilotEndpoint",
  use: "Use createCopilotKitRuntimeHandler from @copilotkit/runtime. In Hono, pass it c.req.raw.",
  docs: "/migrate/runtime-2.0#fetch-and-nextjs",
});

/** @deprecated "createCopilotEndpointExpress" was removed in CopilotKit 2.0. Mount createCopilotKitNodeListener from @copilotkit/runtime/node in your Express app. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#node-and-express */
export const createCopilotEndpointExpress = /*#__PURE__*/ removedApi({
  name: "createCopilotEndpointExpress",
  use: "Mount createCopilotKitNodeListener from @copilotkit/runtime/node in your Express app.",
  docs: "/migrate/runtime-2.0#node-and-express",
});

/** @deprecated "createCopilotEndpointSingleRoute" was removed in CopilotKit 2.0. Use createCopilotKitRuntimeHandler from @copilotkit/runtime with mode: "single-route". Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#single-route-endpoints */
export const createCopilotEndpointSingleRoute = /*#__PURE__*/ removedApi({
  name: "createCopilotEndpointSingleRoute",
  use: 'Use createCopilotKitRuntimeHandler from @copilotkit/runtime with mode: "single-route".',
  docs: "/migrate/runtime-2.0#single-route-endpoints",
});

/** @deprecated "createCopilotEndpointSingleRouteExpress" was removed in CopilotKit 2.0. Use createCopilotKitNodeListener from @copilotkit/runtime/node with mode: "single-route". Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#single-route-endpoints */
export const createCopilotEndpointSingleRouteExpress = /*#__PURE__*/ removedApi(
  {
    name: "createCopilotEndpointSingleRouteExpress",
    use: 'Use createCopilotKitNodeListener from @copilotkit/runtime/node with mode: "single-route".',
    docs: "/migrate/runtime-2.0#single-route-endpoints",
  },
);

/** @deprecated "createCopilotExpressHandler" was removed in CopilotKit 2.0. Mount createCopilotKitNodeListener from @copilotkit/runtime/node in your Express app. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#node-and-express */
export const createCopilotExpressHandler = /*#__PURE__*/ removedApi({
  name: "createCopilotExpressHandler",
  use: "Mount createCopilotKitNodeListener from @copilotkit/runtime/node in your Express app.",
  docs: "/migrate/runtime-2.0#node-and-express",
});

/** @deprecated "createCopilotHonoHandler" was removed in CopilotKit 2.0. Use createCopilotKitRuntimeHandler from @copilotkit/runtime. In Hono, pass it c.req.raw. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#fetch-and-nextjs */
export const createCopilotHonoHandler = /*#__PURE__*/ removedApi({
  name: "createCopilotHonoHandler",
  use: "Use createCopilotKitRuntimeHandler from @copilotkit/runtime. In Hono, pass it c.req.raw.",
  docs: "/migrate/runtime-2.0#fetch-and-nextjs",
});

/** @deprecated "CreateCopilotRuntimeServerOptions" was removed in CopilotKit 2.0. Use CopilotKitRuntimeHandlerOptions from @copilotkit/runtime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#fetch-and-nextjs */
export type CreateCopilotRuntimeServerOptions = RemovedType<
  "CreateCopilotRuntimeServerOptions",
  "Use CopilotKitRuntimeHandlerOptions from @copilotkit/runtime.",
  "/migrate/runtime-2.0#fetch-and-nextjs"
>;

/** @deprecated "createLogger" was removed in CopilotKit 2.0. Pass a logger (CopilotKitRuntimeLogger) to CopilotKitRuntime from @copilotkit/runtime, or set debug: true for debug logs. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#debug-logs */
export const createLogger = /*#__PURE__*/ removedApi({
  name: "createLogger",
  use: "Pass a logger (CopilotKitRuntimeLogger) to CopilotKitRuntime from @copilotkit/runtime, or set debug: true for debug logs.",
  docs: "/migrate/runtime-2.0#debug-logs",
});

/** @deprecated "createSafeUrlDownload" was removed in CopilotKit 2.0. Import it from @copilotkit/runtime/agent. It does not need the ai package. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */
export const createSafeUrlDownload = /*#__PURE__*/ removedApi({
  name: "createSafeUrlDownload",
  use: "Import it from @copilotkit/runtime/agent. It does not need the ai package.",
  docs: "/migrate/runtime-2.0#built-in-agent",
});

/** @deprecated "CreateSafeUrlDownloadOptions" was removed in CopilotKit 2.0. Import it from @copilotkit/runtime/agent. It does not need the ai package. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */
export type CreateSafeUrlDownloadOptions = RemovedType<
  "CreateSafeUrlDownloadOptions",
  "Import it from @copilotkit/runtime/agent. It does not need the ai package.",
  "/migrate/runtime-2.0#built-in-agent"
>;

/** @deprecated "CustomEventNames" was removed in CopilotKit 2.0. Import CustomEventNames from @ag-ui/langgraph. Its members have new names and values. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/agents-2.0#customeventnames */
export type CustomEventNames = RemovedType<
  "CustomEventNames",
  "Import CustomEventNames from @ag-ui/langgraph. Its members have new names and values.",
  "/migrate/agents-2.0#customeventnames"
>;

/** @deprecated "EmptyAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 needs no service adapter. Delete it, and pass your agents in agents on CopilotKitRuntime from @copilotkit/runtime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const EmptyAdapter = /*#__PURE__*/ removedApi({
  name: "EmptyAdapter",
  use: "CopilotKit 2.0 needs no service adapter. Delete it, and pass your agents in agents on CopilotKitRuntime from @copilotkit/runtime.",
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "EmptyAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 needs no service adapter. Delete it, and pass your agents in agents on CopilotKitRuntime from @copilotkit/runtime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type EmptyAdapter = typeof EmptyAdapter;

/** @deprecated "ExperimentalEmptyAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 needs no service adapter. Delete it, and pass your agents in agents on CopilotKitRuntime from @copilotkit/runtime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const ExperimentalEmptyAdapter = /*#__PURE__*/ removedApi({
  name: "ExperimentalEmptyAdapter",
  use: "CopilotKit 2.0 needs no service adapter. Delete it, and pass your agents in agents on CopilotKitRuntime from @copilotkit/runtime.",
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "ExperimentalEmptyAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 needs no service adapter. Delete it, and pass your agents in agents on CopilotKitRuntime from @copilotkit/runtime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type ExperimentalEmptyAdapter = typeof ExperimentalEmptyAdapter;

/** @deprecated "ExperimentalOllamaAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const ExperimentalOllamaAdapter = /*#__PURE__*/ removedApi({
  name: "ExperimentalOllamaAdapter",
  use: 'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "ExperimentalOllamaAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type ExperimentalOllamaAdapter = typeof ExperimentalOllamaAdapter;

/** @deprecated "extractParametersFromSchema" was removed in CopilotKit 2.0. Create the MCP client with createMCPClient from @tanstack/ai-mcp, and pass it to a BuiltInAgent as mcp: { clients: [client] }. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#4-replace-mcpservers-with-mcp */
export const extractParametersFromSchema = /*#__PURE__*/ removedApi({
  name: "extractParametersFromSchema",
  use: "Create the MCP client with createMCPClient from @tanstack/ai-mcp, and pass it to a BuiltInAgent as mcp: { clients: [client] }.",
  docs: "/migrate/runtime-2.0#4-replace-mcpservers-with-mcp",
});

/** @deprecated "FilterThinkingTextBuffer" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const FilterThinkingTextBuffer = /*#__PURE__*/ removedApi({
  name: "FilterThinkingTextBuffer",
  use: 'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "FilterThinkingTextBuffer" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type FilterThinkingTextBuffer = typeof FilterThinkingTextBuffer;

/** @deprecated "generateMcpToolInstructions" was removed in CopilotKit 2.0. Create the MCP client with createMCPClient from @tanstack/ai-mcp, and pass it to a BuiltInAgent as mcp: { clients: [client] }. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#4-replace-mcpservers-with-mcp */
export const generateMcpToolInstructions = /*#__PURE__*/ removedApi({
  name: "generateMcpToolInstructions",
  use: "Create the MCP client with createMCPClient from @tanstack/ai-mcp, and pass it to a BuiltInAgent as mcp: { clients: [client] }.",
  docs: "/migrate/runtime-2.0#4-replace-mcpservers-with-mcp",
});

/** @deprecated "getCommonConfig" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const getCommonConfig = /*#__PURE__*/ removedApi({
  name: "getCommonConfig",
  use: 'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  docs: "/migrate/v2#update-the-runtime",
});

/** @deprecated "getSdkClientOptions" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const getSdkClientOptions = /*#__PURE__*/ removedApi({
  name: "getSdkClientOptions",
  use: 'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  docs: "/migrate/v2#update-the-runtime",
});

/** @deprecated "GoogleGenerativeAIAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const GoogleGenerativeAIAdapter = /*#__PURE__*/ removedApi({
  name: "GoogleGenerativeAIAdapter",
  use: 'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "GoogleGenerativeAIAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type GoogleGenerativeAIAdapter = typeof GoogleGenerativeAIAdapter;

/** @deprecated "GraphQLContext" was removed in CopilotKit 2.0. CopilotKit 2.0 has no GraphQL endpoint. Read the request in the hooks option of createCopilotKitRuntimeHandler (CopilotKitRuntimeHooks from @copilotkit/runtime). Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type GraphQLContext = RemovedType<
  "GraphQLContext",
  "CopilotKit 2.0 has no GraphQL endpoint. Read the request in the hooks option of createCopilotKitRuntimeHandler (CopilotKitRuntimeHooks from @copilotkit/runtime).",
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "GraphQLRequestContext" was removed in CopilotKit 2.0. CopilotKit 2.0 has no GraphQL endpoint. Read the request in the hooks option of createCopilotKitRuntimeHandler (CopilotKitRuntimeHooks from @copilotkit/runtime). Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type GraphQLRequestContext = RemovedType<
  "GraphQLRequestContext",
  "CopilotKit 2.0 has no GraphQL endpoint. Read the request in the hooks option of createCopilotKitRuntimeHandler (CopilotKitRuntimeHooks from @copilotkit/runtime).",
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "GroqAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const GroqAdapter = /*#__PURE__*/ removedApi({
  name: "GroqAdapter",
  use: 'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "GroqAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type GroqAdapter = typeof GroqAdapter;

/** @deprecated "GroqAdapterParams" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type GroqAdapterParams = RemovedType<
  "GroqAdapterParams",
  'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "GuardrailsValidationFailureResponse" was removed in CopilotKit 2.0. CopilotKit 2.0 has no GraphQL endpoint. A failed run reaches the frontend as an AG-UI RUN_ERROR event. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const GuardrailsValidationFailureResponse = /*#__PURE__*/ removedApi({
  name: "GuardrailsValidationFailureResponse",
  use: "CopilotKit 2.0 has no GraphQL endpoint. A failed run reaches the frontend as an AG-UI RUN_ERROR event.",
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "GuardrailsValidationFailureResponse" was removed in CopilotKit 2.0. CopilotKit 2.0 has no GraphQL endpoint. A failed run reaches the frontend as an AG-UI RUN_ERROR event. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type GuardrailsValidationFailureResponse =
  typeof GuardrailsValidationFailureResponse;

/** @deprecated "isA2UIEnabled" was removed in CopilotKit 2.0. The runtime a2ui option is now generativeUI: { a2uiVersion: "0.9" }. Read generativeUI on your runtime options. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export const isA2UIEnabled = /*#__PURE__*/ removedApi({
  name: "isA2UIEnabled",
  use: 'The runtime a2ui option is now generativeUI: { a2uiVersion: "0.9" }. Read generativeUI on your runtime options.',
  docs: "/migrate/generative-ui-2.0#a2ui-v09-renderer",
});

/** @deprecated "LangChainAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const LangChainAdapter = /*#__PURE__*/ removedApi({
  name: "LangChainAdapter",
  use: 'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "LangChainAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type LangChainAdapter = typeof LangChainAdapter;

/** @deprecated "LangGraphAgent" was removed in CopilotKit 2.0. Import LangGraphAgent from @ag-ui/langgraph. The constructor options are the same. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-agents */
export const LangGraphAgent = /*#__PURE__*/ removedApi({
  name: "LangGraphAgent",
  use: "Import LangGraphAgent from @ag-ui/langgraph. The constructor options are the same.",
  docs: "/migrate/agents-2.0#langgraph-agents",
});
/** @deprecated "LangGraphAgent" was removed in CopilotKit 2.0. Import LangGraphAgent from @ag-ui/langgraph. The constructor options are the same. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-agents */
export type LangGraphAgent = typeof LangGraphAgent;

/** @deprecated "LangGraphHttpAgent" was removed in CopilotKit 2.0. Import LangGraphHttpAgent from @ag-ui/langgraph. The constructor options are the same. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-agents */
export const LangGraphHttpAgent = /*#__PURE__*/ removedApi({
  name: "LangGraphHttpAgent",
  use: "Import LangGraphHttpAgent from @ag-ui/langgraph. The constructor options are the same.",
  docs: "/migrate/agents-2.0#langgraph-agents",
});
/** @deprecated "LangGraphHttpAgent" was removed in CopilotKit 2.0. Import LangGraphHttpAgent from @ag-ui/langgraph. The constructor options are the same. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-agents */
export type LangGraphHttpAgent = typeof LangGraphHttpAgent;

/** @deprecated "langGraphPlatformEndpoint" was removed in CopilotKit 2.0. CopilotKitRuntime has no remoteEndpoints. Create a LangGraphAgent from @ag-ui/langgraph for each agent, and pass it in agents. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-platform */
export const langGraphPlatformEndpoint = /*#__PURE__*/ removedApi({
  name: "langGraphPlatformEndpoint",
  use: "CopilotKitRuntime has no remoteEndpoints. Create a LangGraphAgent from @ag-ui/langgraph for each agent, and pass it in agents.",
  docs: "/migrate/agents-2.0#langgraph-platform",
});

/** @deprecated "LogLevel" was removed in CopilotKit 2.0. Pass a logger (CopilotKitRuntimeLogger) to CopilotKitRuntime from @copilotkit/runtime, or set debug: true for debug logs. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#debug-logs */
export type LogLevel = RemovedType<
  "LogLevel",
  "Pass a logger (CopilotKitRuntimeLogger) to CopilotKitRuntime from @copilotkit/runtime, or set debug: true for debug logs.",
  "/migrate/runtime-2.0#debug-logs"
>;

/** @deprecated "MCPClient" was removed in CopilotKit 2.0. Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#4-replace-mcpservers-with-mcp */
export type MCPClient = RemovedType<
  "MCPClient",
  "Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }.",
  "/migrate/runtime-2.0#4-replace-mcpservers-with-mcp"
>;

/** @deprecated "MCPClientConfig" was removed in CopilotKit 2.0. Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#4-replace-mcpservers-with-mcp */
export type MCPClientConfig = RemovedType<
  "MCPClientConfig",
  "Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }.",
  "/migrate/runtime-2.0#4-replace-mcpservers-with-mcp"
>;

/** @deprecated "MCPClientConfigHTTP" was removed in CopilotKit 2.0. Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#4-replace-mcpservers-with-mcp */
export type MCPClientConfigHTTP = RemovedType<
  "MCPClientConfigHTTP",
  "Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }.",
  "/migrate/runtime-2.0#4-replace-mcpservers-with-mcp"
>;

/** @deprecated "MCPClientConfigSSE" was removed in CopilotKit 2.0. Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#4-replace-mcpservers-with-mcp */
export type MCPClientConfigSSE = RemovedType<
  "MCPClientConfigSSE",
  "Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }.",
  "/migrate/runtime-2.0#4-replace-mcpservers-with-mcp"
>;

/** @deprecated "MCPClientProvider" was removed in CopilotKit 2.0. Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#4-replace-mcpservers-with-mcp */
export type MCPClientProvider = RemovedType<
  "MCPClientProvider",
  "Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }.",
  "/migrate/runtime-2.0#4-replace-mcpservers-with-mcp"
>;

/** @deprecated "MCPEndpointConfig" was removed in CopilotKit 2.0. Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#4-replace-mcpservers-with-mcp */
export type MCPEndpointConfig = RemovedType<
  "MCPEndpointConfig",
  "Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }.",
  "/migrate/runtime-2.0#4-replace-mcpservers-with-mcp"
>;

/** @deprecated "MCPTool" was removed in CopilotKit 2.0. Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#4-replace-mcpservers-with-mcp */
export type MCPTool = RemovedType<
  "MCPTool",
  "Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }.",
  "/migrate/runtime-2.0#4-replace-mcpservers-with-mcp"
>;

/** @deprecated "MCPTransport" was removed in CopilotKit 2.0. Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#4-replace-mcpservers-with-mcp */
export type MCPTransport = RemovedType<
  "MCPTransport",
  "Import the MCP client types from @tanstack/ai-mcp, and pass each client to a BuiltInAgent as mcp: { clients: [client] }.",
  "/migrate/runtime-2.0#4-replace-mcpservers-with-mcp"
>;

/** @deprecated "MessageConversionOptions" was removed in CopilotKit 2.0. 2.0 exports the AI SDK helpers from @copilotkit/runtime/agent/ai-sdk. Import it from there, and add the ai package to your app. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */
export type MessageConversionOptions = RemovedType<
  "MessageConversionOptions",
  "2.0 exports the AI SDK helpers from @copilotkit/runtime/agent/ai-sdk. Import it from there, and add the ai package to your app.",
  "/migrate/runtime-2.0#built-in-agent"
>;

/** @deprecated "MessageStreamInterruptedResponse" was removed in CopilotKit 2.0. CopilotKit 2.0 has no GraphQL endpoint. A failed run reaches the frontend as an AG-UI RUN_ERROR event. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const MessageStreamInterruptedResponse = /*#__PURE__*/ removedApi({
  name: "MessageStreamInterruptedResponse",
  use: "CopilotKit 2.0 has no GraphQL endpoint. A failed run reaches the frontend as an AG-UI RUN_ERROR event.",
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "MessageStreamInterruptedResponse" was removed in CopilotKit 2.0. CopilotKit 2.0 has no GraphQL endpoint. A failed run reaches the frontend as an AG-UI RUN_ERROR event. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type MessageStreamInterruptedResponse =
  typeof MessageStreamInterruptedResponse;

/** @deprecated "ModelSpecifier" was removed in CopilotKit 2.0. Use AnyTextAdapter from @tanstack/ai: the model of a BuiltInAgent is a TanStack AI text adapter. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */
export type ModelSpecifier = RemovedType<
  "ModelSpecifier",
  "Use AnyTextAdapter from @tanstack/ai: the model of a BuiltInAgent is a TanStack AI text adapter.",
  "/migrate/runtime-2.0#built-in-agent"
>;

/** @deprecated "OpenAIAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const OpenAIAdapter = /*#__PURE__*/ removedApi({
  name: "OpenAIAdapter",
  use: 'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "OpenAIAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type OpenAIAdapter = typeof OpenAIAdapter;

/** @deprecated "OpenAIAdapterParams" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type OpenAIAdapterParams = RemovedType<
  "OpenAIAdapterParams",
  'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "OpenAIAssistantAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const OpenAIAssistantAdapter = /*#__PURE__*/ removedApi({
  name: "OpenAIAssistantAdapter",
  use: 'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "OpenAIAssistantAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type OpenAIAssistantAdapter = typeof OpenAIAssistantAdapter;

/** @deprecated "OpenAIAssistantAdapterParams" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type OpenAIAssistantAdapterParams = RemovedType<
  "OpenAIAssistantAdapterParams",
  'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "PredictStateTool" was removed in CopilotKit 2.0. Import PredictStateTool from @ag-ui/langgraph. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-agents */
export type PredictStateTool = RemovedType<
  "PredictStateTool",
  "Import PredictStateTool from @ag-ui/langgraph.",
  "/migrate/agents-2.0#langgraph-agents"
>;

/** @deprecated "RemoteChain" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const RemoteChain = /*#__PURE__*/ removedApi({
  name: "RemoteChain",
  use: 'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "RemoteChain" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type RemoteChain = typeof RemoteChain;

/** @deprecated "RemoteChainParameters" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type RemoteChainParameters = RemovedType<
  "RemoteChainParameters",
  'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "resolveEndpointType" was removed in CopilotKit 2.0. CopilotKitRuntime has no remoteEndpoints. Register each agent in agents on CopilotKitRuntime from @copilotkit/runtime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-platform */
export const resolveEndpointType = /*#__PURE__*/ removedApi({
  name: "resolveEndpointType",
  use: "CopilotKitRuntime has no remoteEndpoints. Register each agent in agents on CopilotKitRuntime from @copilotkit/runtime.",
  docs: "/migrate/agents-2.0#langgraph-platform",
});

/** @deprecated "resolveModel" was removed in CopilotKit 2.0. Pass an adapter as model, for example anthropicText("claude-sonnet-4-6"). To switch models from the frontend, set the resolveModel option of the BuiltInAgent. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#if-you-used-resolvemodel-or-classifymodelspec */
export const resolveModel = /*#__PURE__*/ removedApi({
  name: "resolveModel",
  use: 'Pass an adapter as model, for example anthropicText("claude-sonnet-4-6"). To switch models from the frontend, set the resolveModel option of the BuiltInAgent.',
  docs: "/migrate/runtime-2.0#if-you-used-resolvemodel-or-classifymodelspec",
});

/** @deprecated "SafeUrlDownloadOptions" was removed in CopilotKit 2.0. Import it from @copilotkit/runtime/agent. It does not need the ai package. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent */
export type SafeUrlDownloadOptions = RemovedType<
  "SafeUrlDownloadOptions",
  "Import it from @copilotkit/runtime/agent. It does not need the ai package.",
  "/migrate/runtime-2.0#built-in-agent"
>;

/** @deprecated "SdkClientLike" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type SdkClientLike = RemovedType<
  "SdkClientLike",
  'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "TelemetryAgentRunner" was removed in CopilotKit 2.0. Delete the wrapper, and pass your runner as runner on CopilotKitRuntime. The runtime reports telemetry by itself. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#telemetry-entry-point-removed */
export const TelemetryAgentRunner = /*#__PURE__*/ removedApi({
  name: "TelemetryAgentRunner",
  use: "Delete the wrapper, and pass your runner as runner on CopilotKitRuntime. The runtime reports telemetry by itself.",
  docs: "/migrate/shared-2.0#telemetry-entry-point-removed",
});
/** @deprecated "TelemetryAgentRunner" was removed in CopilotKit 2.0. Delete the wrapper, and pass your runner as runner on CopilotKitRuntime. The runtime reports telemetry by itself. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#telemetry-entry-point-removed */
export type TelemetryAgentRunner = typeof TelemetryAgentRunner;

/** @deprecated "TelemetryAgentRunnerConfig" was removed in CopilotKit 2.0. Delete the wrapper, and pass your runner as runner on CopilotKitRuntime. The runtime reports telemetry by itself. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#telemetry-entry-point-removed */
export type TelemetryAgentRunnerConfig = RemovedType<
  "TelemetryAgentRunnerConfig",
  "Delete the wrapper, and pass your runner as runner on CopilotKitRuntime. The runtime reports telemetry by itself.",
  "/migrate/shared-2.0#telemetry-entry-point-removed"
>;

/** @deprecated "TextMessageEvents" was removed in CopilotKit 2.0. Import the AG-UI event types, such as TextMessageStartEvent, from @ag-ui/client. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-agents */
export type TextMessageEvents = RemovedType<
  "TextMessageEvents",
  "Import the AG-UI event types, such as TextMessageStartEvent, from @ag-ui/client.",
  "/migrate/agents-2.0#langgraph-agents"
>;

/** @deprecated "toFetchCorsConfig" was removed in CopilotKit 2.0. Pass a CopilotKitCorsConfig as the cors option of createCopilotKitRuntimeHandler from @copilotkit/runtime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/runtime-2.0#cors-and-lifecycle */
export const toFetchCorsConfig = /*#__PURE__*/ removedApi({
  name: "toFetchCorsConfig",
  use: "Pass a CopilotKitCorsConfig as the cors option of createCopilotKitRuntimeHandler from @copilotkit/runtime.",
  docs: "/migrate/runtime-2.0#cors-and-lifecycle",
});

/** @deprecated "ToolCallEvents" was removed in CopilotKit 2.0. Import the AG-UI event types, such as ToolCallStartEvent, from @ag-ui/client. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/agents-2.0#langgraph-agents */
export type ToolCallEvents = RemovedType<
  "ToolCallEvents",
  "Import the AG-UI event types, such as ToolCallStartEvent, from @ag-ui/client.",
  "/migrate/agents-2.0#langgraph-agents"
>;

/** @deprecated "UnifyAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const UnifyAdapter = /*#__PURE__*/ removedApi({
  name: "UnifyAdapter",
  use: 'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "UnifyAdapter" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type UnifyAdapter = typeof UnifyAdapter;

/** @deprecated "UnifyAdapterParams" was removed in CopilotKit 2.0. CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type UnifyAdapterParams = RemovedType<
  "UnifyAdapterParams",
  'CopilotKit 2.0 has no service adapters. Run the model in a BuiltInAgent from @copilotkit/runtime/agent with a TanStack AI adapter, for example new BuiltInAgent({ model: openaiText("gpt-5") }), and pass it in agents on CopilotKitRuntime.',
  "/migrate/v2#update-the-runtime"
>;

/** @deprecated "UnknownErrorResponse" was removed in CopilotKit 2.0. CopilotKit 2.0 has no GraphQL endpoint. A failed run reaches the frontend as an AG-UI RUN_ERROR event. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export const UnknownErrorResponse = /*#__PURE__*/ removedApi({
  name: "UnknownErrorResponse",
  use: "CopilotKit 2.0 has no GraphQL endpoint. A failed run reaches the frontend as an AG-UI RUN_ERROR event.",
  docs: "/migrate/v2#update-the-runtime",
});
/** @deprecated "UnknownErrorResponse" was removed in CopilotKit 2.0. CopilotKit 2.0 has no GraphQL endpoint. A failed run reaches the frontend as an AG-UI RUN_ERROR event. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#update-the-runtime */
export type UnknownErrorResponse = typeof UnknownErrorResponse;
