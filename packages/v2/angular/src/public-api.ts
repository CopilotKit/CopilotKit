// Core configuration & setup
export {
  type CopilotKitConfig,
  COPILOT_KIT_CONFIG,
  injectCopilotKitConfig,
  provideCopilotKit,
} from "./lib/config";

export { CopilotKit } from "./lib/copilotkit";

export {
  type AngularToolCall,
  type HumanInTheLoopToolCall,
  type ToolRenderer,
  type HumanInTheLoopToolRenderer,
  type ClientTool,
  type RenderToolCallConfig,
  type FrontendToolConfig,
  type HumanInTheLoopConfig,
  registerRenderToolCall,
  registerFrontendTool,
  registerHumanInTheLoop,
} from "./lib/tools";

export { RenderToolCalls } from "./lib/render-tool-calls";

export {
  AgentStore,
  CopilotkitAgentFactory,
  injectAgentStore,
} from "./lib/agent";

export {
  type CopilotChatLabels,
  COPILOT_CHAT_DEFAULT_LABELS,
  COPILOT_CHAT_LABELS,
  injectChatLabels,
  provideCopilotChatLabels,
} from "./lib/chat-config";

export { ChatState, injectChatState } from "./lib/chat-state";

export { type ScrollState, ScrollPosition } from "./lib/scroll-position";

export { type ResizeState, ResizeObserverService } from "./lib/resize-observer";

export { cn } from "./lib/utils";

export {
  type ConnectAgentContextConfig,
  connectAgentContext,
} from "./lib/agent-context";

// Slots
export {
  type SlotValue,
  type SlotConfig,
  type SlotContext,
  type SlotRegistryEntry,
  type RenderSlotOptions,
  SLOT_CONFIG,
  type WithSlots,
} from "./lib/slots/slot.types";

export {
  renderSlot,
  isComponentType,
  isSlotValue,
  normalizeSlotValue,
  createSlotConfig,
  provideSlots,
  getSlotConfig,
  createSlotRenderer,
} from "./lib/slots/slot.utils";

export { CopilotSlot } from "./lib/slots/copilot-slot";

// Directives
export { CopilotKitAgentContext } from "./lib/directives/copilotkit-agent-context";

export { type ScrollBehavior, StickToBottom } from "./lib/directives/stick-to-bottom";

export { TooltipContent, CopilotTooltip } from "./lib/directives/tooltip";

// Chat components
export { CopilotChat } from "./lib/components/chat/copilot-chat";

export { CopilotChatAssistantMessage } from "./lib/components/chat/copilot-chat-assistant-message";

export {
  CopilotChatAssistantMessageToolbarButton,
  CopilotChatAssistantMessageCopyButton,
  CopilotChatAssistantMessageThumbsUpButton,
  CopilotChatAssistantMessageThumbsDownButton,
  CopilotChatAssistantMessageReadAloudButton,
  CopilotChatAssistantMessageRegenerateButton,
} from "./lib/components/chat/copilot-chat-assistant-message-buttons";

export { CopilotChatAssistantMessageRenderer } from "./lib/components/chat/copilot-chat-assistant-message-renderer";

export { CopilotChatAssistantMessageToolbar } from "./lib/components/chat/copilot-chat-assistant-message-toolbar";

export {
  type AssistantMessageMarkdownRendererContext,
  type AssistantMessageToolbarContext,
  type AssistantMessageCopyButtonContext,
  type ThumbsUpButtonContext,
  type ThumbsDownButtonContext,
  type ReadAloudButtonContext,
  type RegenerateButtonContext,
  type CopilotChatAssistantMessageOnThumbsUpProps,
  type CopilotChatAssistantMessageOnThumbsDownProps,
  type CopilotChatAssistantMessageOnReadAloudProps,
  type CopilotChatAssistantMessageOnRegenerateProps,
  type AssistantMessage,
} from "./lib/components/chat/copilot-chat-assistant-message.types";

export { CopilotChatAudioRecorder } from "./lib/components/chat/copilot-chat-audio-recorder";

export {
  CopilotChatSendButton,
  CopilotChatStartTranscribeButton,
  CopilotChatCancelTranscribeButton,
  CopilotChatFinishTranscribeButton,
  CopilotChatAddFileButton,
  CopilotChatToolbarButton,
} from "./lib/components/chat/copilot-chat-buttons";

export { CopilotChatInput } from "./lib/components/chat/copilot-chat-input";

export { CopilotChatInputDefaults } from "./lib/components/chat/copilot-chat-input-defaults";

export {
  type CopilotChatInputMode,
  type ToolsMenuItem,
  type AudioRecorderState,
  AudioRecorderError,
  type CopilotChatTextareaProps,
  type CopilotChatButtonProps,
  type CopilotChatToolbarButtonProps,
  type CopilotChatToolsButtonProps,
  type CopilotChatAudioRecorderProps,
  type CopilotChatToolbarProps,
  type CopilotChatInputSlots,
  type CopilotChatInputConfig,
  type CopilotChatInputOutputs,
} from "./lib/components/chat/copilot-chat-input.types";

export { CopilotChatMessageView } from "./lib/components/chat/copilot-chat-message-view";

export { CopilotChatMessageViewCursor } from "./lib/components/chat/copilot-chat-message-view-cursor";

export {
  type MessageViewContext,
  type CursorContext,
  type CopilotChatMessageViewProps,
  type Message,
} from "./lib/components/chat/copilot-chat-message-view.types";

export { CopilotChatTextarea } from "./lib/components/chat/copilot-chat-textarea";

export { CopilotChatToolCallsView } from "./lib/components/chat/copilot-chat-tool-calls-view";

export { CopilotChatToolbar } from "./lib/components/chat/copilot-chat-toolbar";

export { CopilotChatToolsMenu } from "./lib/components/chat/copilot-chat-tools-menu";

export { CopilotChatUserMessage } from "./lib/components/chat/copilot-chat-user-message";

export { CopilotChatUserMessageBranchNavigation } from "./lib/components/chat/copilot-chat-user-message-branch-navigation";

export {
  CopilotChatUserMessageToolbarButton,
  CopilotChatUserMessageCopyButton,
  CopilotChatUserMessageEditButton,
} from "./lib/components/chat/copilot-chat-user-message-buttons";

export { CopilotChatUserMessageRenderer } from "./lib/components/chat/copilot-chat-user-message-renderer";

export { CopilotChatUserMessageToolbar } from "./lib/components/chat/copilot-chat-user-message-toolbar";

export {
  type CopilotChatUserMessageOnEditMessageProps,
  type CopilotChatUserMessageOnSwitchToBranchProps,
  type MessageRendererContext,
  type CopyButtonContext,
  type EditButtonContext,
  type BranchNavigationContext,
  type UserMessageToolbarContext,
} from "./lib/components/chat/copilot-chat-user-message.types";

export { CopilotChatView } from "./lib/components/chat/copilot-chat-view";

export {
  type CopilotChatViewProps,
  type CopilotChatViewLayoutContext,
} from "./lib/components/chat/copilot-chat-view.types";

export { CopilotChatViewDisclaimer } from "./lib/components/chat/copilot-chat-view-disclaimer";

export { CopilotChatViewFeather } from "./lib/components/chat/copilot-chat-view-feather";

export { CopilotChatViewHandlers } from "./lib/components/chat/copilot-chat-view-handlers";

export { CopilotChatViewInputContainer } from "./lib/components/chat/copilot-chat-view-input-container";

export { CopilotChatViewScrollToBottomButton } from "./lib/components/chat/copilot-chat-view-scroll-to-bottom-button";

export { CopilotChatViewScrollView } from "./lib/components/chat/copilot-chat-view-scroll-view";
