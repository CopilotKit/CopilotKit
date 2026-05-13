// V1 compat entry -- re-exports v2 with backward-compat wrappers
export * from "./v2";

// V1 wrapper overrides (these shadow v2 exports where the API differs)
export { useCopilotAction } from "./hooks";
export type { FrontendAction, CatchAllFrontendAction } from "./hooks";
export { useFrontendTool } from "./hooks";
export type { UseFrontendToolArgs } from "./hooks";
export { useCopilotReadable } from "./hooks";
export type { UseCopilotReadableOptions } from "./hooks";
export { CopilotKit } from "./components/copilot-provider";
export type { CopilotKitProps } from "./components/copilot-provider";
