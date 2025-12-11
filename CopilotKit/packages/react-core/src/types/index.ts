import type { ForwardedParametersInput } from "@copilotkit/runtime-client-gql";

export type { DocumentPointer } from "./document-pointer";
export type { SystemMessageFunction } from "./system-message";
export type {
  ActionRenderProps,
  ActionRenderPropsNoArgs,
  ActionRenderPropsWait,
  ActionRenderPropsNoArgsWait,
  FrontendAction,
  FrontendActionAvailability,
  RenderFunctionStatus,
  CatchAllActionRenderProps,
  CatchAllFrontendAction,
} from "./frontend-action";

export type { CopilotChatSuggestionConfiguration } from "./chat-suggestion-configuration";
export * from "./crew";

// Type alias for the subset of forwarded parameters used in react-core
export type ForwardedParametersSubset = Partial<
  Pick<ForwardedParametersInput, "temperature" | "maxTokens">
>;
