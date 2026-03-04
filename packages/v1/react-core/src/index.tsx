"use client";
export { CopilotKit, defaultCopilotContextCategories } from "./components";
export type { CopilotKitProps } from "./components";

export {
  CopilotContext,
  useCopilotContext,
  CopilotMessagesContext,
  useCopilotMessagesContext,
  CoAgentStateRendersContext,
  CoAgentStateRendersProvider,
  useCoAgentStateRenders,
  ThreadsContext,
  ThreadsProvider,
  useThreads,
} from "./context";
export type {
  CopilotContextParams,
  CoagentInChatRenderFunction,
  CopilotApiConfig,
  CopilotMessagesContextParams,
  CoAgentStateRendersContextValue,
  ThreadsContextValue,
  ThreadsProviderProps,
} from "./context";

export {
  useCopilotChat,
  useCopilotChatHeadless_c,
  useCopilotChatInternal,
  useCopilotAction,
  useCoAgentStateRender,
  useMakeCopilotDocumentReadable,
  useCopilotReadable,
  useCoAgent,
  useCopilotRuntimeClient,
  useCopilotAuthenticatedAction_c,
  useLangGraphInterrupt,
  useCopilotAdditionalInstructions,
  useFrontendTool,
  useHumanInTheLoop,
  useRenderToolCall,
  useDefaultTool,
  useLazyToolRenderer,
  useCopilotChatSuggestions,
} from "./hooks";
export type {
  UseCopilotChatReturn,
  UseCopilotChatOptions,
  UseCopilotChatReturn_c,
  UseCopilotChatOptions_c,
  ChatSuggestions,
  OnReloadMessages,
  OnStopGeneration,
  HintFunction,
  Tree,
  TreeNode,
  UseCopilotChatSuggestionsConfiguration,
} from "./hooks";

export type {
  DocumentPointer,
  SystemMessageFunction,
  ActionRenderProps,
  ActionRenderPropsNoArgs,
  ActionRenderPropsWait,
  ActionRenderPropsNoArgsWait,
  FrontendAction,
  FrontendActionAvailability,
  RenderFunctionStatus,
  CatchAllActionRenderProps,
  CatchAllFrontendAction,
  CopilotChatSuggestionConfiguration,
  CrewsResponseStatus,
  CrewsResponse,
  CrewsStateItem,
  CrewsToolStateItem,
  CrewsTaskStateItem,
  CrewsAgentState,
  LangGraphInterruptRenderHandlerProps,
  LangGraphInterruptRenderProps,
  LangGraphInterruptRender,
  LangGraphInterruptAction,
  LangGraphInterruptActionSetterArgs,
  LangGraphInterruptActionSetter,
  QueuedInterruptEvent,
} from "./types";

export { type CopilotTaskConfig, CopilotTask } from "./lib";

export { SUGGESTION_RETRY_CONFIG, shouldShowDevConsole } from "./utils";
