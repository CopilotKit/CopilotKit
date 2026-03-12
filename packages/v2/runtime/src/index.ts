export * from "./core/runtime";
export * from "./endpoints";

// Export agent runners and base types
export * from "./runner";

// Export transcription services
export * from "./transcription-service/transcription-service";

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
/** @deprecated Use `CopilotRuntimeFetchHandler` instead. */
export type CopilotKitRequestHandler = (params: {
  request: Request;
}) => Promise<Response>;
