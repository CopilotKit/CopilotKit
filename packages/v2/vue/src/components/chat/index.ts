export * from "./types";
export { default as CopilotChatAssistantMessage } from "./CopilotChatAssistantMessage.vue";
export { default as CopilotChatAudioRecorder } from "./CopilotChatAudioRecorder.vue";
import _CopilotChat from "./CopilotChat.vue";
import _CopilotChatView from "./CopilotChatView.vue";
export { default as CopilotChatInput } from "./CopilotChatInput.vue";
export { default as CopilotChatMessageView } from "./CopilotChatMessageView.vue";
export { default as CopilotChatSuggestionPill } from "./CopilotChatSuggestionPill.vue";
export { default as CopilotChatSuggestionView } from "./CopilotChatSuggestionView.vue";
export { default as CopilotChatToolCallsView } from "./CopilotChatToolCallsView.vue";
export { default as CopilotChatUserMessage } from "./CopilotChatUserMessage.vue";
export { default as CopilotChatView } from "./CopilotChatView.vue";
import _CopilotChatToggleButton from "./CopilotChatToggleButton.vue";
import CopilotChatToggleButtonCloseIcon from "./CopilotChatToggleButtonCloseIcon";
import CopilotChatToggleButtonOpenIcon from "./CopilotChatToggleButtonOpenIcon";
import _CopilotModalHeader from "./CopilotModalHeader.vue";
import CopilotModalHeaderCloseButton from "./CopilotModalHeaderCloseButton";
import CopilotModalHeaderTitle from "./CopilotModalHeaderTitle";
import _CopilotPopupView from "./CopilotPopupView.vue";
import CopilotPopupWelcomeScreen from "./CopilotPopupWelcomeScreen.vue";
import _CopilotSidebarView from "./CopilotSidebarView.vue";
import CopilotSidebarWelcomeScreen from "./CopilotSidebarWelcomeScreen.vue";

export const CopilotChat = Object.assign(_CopilotChat, {
  View: _CopilotChatView,
});

export const CopilotChatToggleButton = Object.assign(_CopilotChatToggleButton, {
  OpenIcon: CopilotChatToggleButtonOpenIcon,
  CloseIcon: CopilotChatToggleButtonCloseIcon,
});

export { CopilotChatToggleButtonOpenIcon, CopilotChatToggleButtonCloseIcon };

export const CopilotModalHeader = Object.assign(_CopilotModalHeader, {
  Title: CopilotModalHeaderTitle,
  CloseButton: CopilotModalHeaderCloseButton,
});

export const CopilotPopupView = Object.assign(_CopilotPopupView, {
  WelcomeScreen: CopilotPopupWelcomeScreen,
});

export { default as CopilotPopup } from "./CopilotPopup.vue";
export { default as CopilotSidebar } from "./CopilotSidebar.vue";

export const CopilotSidebarView = Object.assign(_CopilotSidebarView, {
  WelcomeScreen: CopilotSidebarWelcomeScreen,
});
