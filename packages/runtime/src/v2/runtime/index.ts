export * from "./core/runtime";
export * from "./endpoints";

// Export agent runners and base types
export * from "./runner";

// Export transcription services
export * from "./transcription-service/transcription-service";

// Export intelligence platform client and types
export {
  CopilotKitIntelligence,
  type CopilotKitIntelligenceConfig,
  type CreateThreadRequest,
  type ThreadSummary,
  type ListThreadsResponse,
  type SubscribeToThreadsRequest,
  type SubscribeToThreadsResponse,
  type UpdateThreadRequest,
} from "./intelligence-platform";

// Re-export `@ai-sdk/mcp` stable types so consumers don't need to depend on
// it directly to type their MCP wiring. `MCPClient` is the value users pass
// into `mcpClients`; `MCPTransport` is the contract for custom transports.
export type { MCPClient, MCPTransport } from "@ai-sdk/mcp";

// Export framework-agnostic fetch handler
export { createCopilotRuntimeHandler } from "./core/fetch-handler";
export type {
  CopilotRuntimeHandlerOptions,
  CopilotRuntimeFetchHandler,
} from "./core/fetch-handler";

// Export hook types
export type {
  CopilotRuntimeHooks,
  HookContext,
  HandlerHookContext,
  ResponseHookContext,
  ErrorHookContext,
  RouteInfo,
} from "./core/hooks";

// Export CORS config type
export type { CopilotCorsConfig } from "./core/fetch-cors";

// Deprecated type aliases for backward compatibility
/** @deprecated Use `CopilotRuntimeFetchHandler` instead. Note: the new type takes `Request` directly, not `{ request: Request }`. */
export type CopilotKitRequestHandler = (params: {
  request: Request;
}) => Promise<Response>;
