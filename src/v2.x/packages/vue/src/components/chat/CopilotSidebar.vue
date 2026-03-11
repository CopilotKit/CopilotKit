<script setup lang="ts">
import CopilotChat from "./CopilotChat.vue";
import CopilotSidebarView from "./CopilotSidebarView.vue";
import CopilotSidebarWelcomeScreen from "./CopilotSidebarWelcomeScreen.vue";
import type {
  CopilotChatMessageViewSlotProps,
  CopilotChatViewOverrideSlotProps,
  CopilotChatWelcomeScreenSlotProps,
  CopilotSidebarProps,
  CopilotSidebarViewHeaderSlotProps,
  CopilotSidebarViewToggleButtonSlotProps,
  CopilotSidebarWelcomeScreenInputSlotProps,
  CopilotSidebarWelcomeScreenSuggestionViewSlotProps,
} from "./types";

function sidebarViewEventBindings(slotProps: CopilotChatViewOverrideSlotProps) {
  return {
    onSubmitMessage: slotProps.onSubmitMessage,
    onInputChange: slotProps.onInputChange,
    onSelectSuggestion: slotProps.onSelectSuggestion,
    ...(slotProps.onStop ? { onStop: slotProps.onStop } : {}),
    ...(slotProps.onAddFile ? { onAddFile: slotProps.onAddFile } : {}),
    ...(slotProps.onStartTranscribe ? { onStartTranscribe: slotProps.onStartTranscribe } : {}),
    ...(slotProps.onCancelTranscribe ? { onCancelTranscribe: slotProps.onCancelTranscribe } : {}),
    ...(slotProps.onFinishTranscribe ? { onFinishTranscribe: slotProps.onFinishTranscribe } : {}),
  };
}

const props = withDefaults(defineProps<CopilotSidebarProps>(), {
  autoScroll: true,
  welcomeScreen: true,
  inputValue: undefined,
  inputMode: "input",
  inputToolsMenu: () => [],
  width: undefined,
  defaultOpen: true,
  onFinishTranscribeWithAudio: undefined,
});

defineSlots<{
  header?: (props: CopilotSidebarViewHeaderSlotProps) => unknown;
  "toggle-button"?: (props: CopilotSidebarViewToggleButtonSlotProps) => unknown;
  "chat-view"?: (props: CopilotChatViewOverrideSlotProps) => unknown;
  "message-view"?: (props: CopilotChatMessageViewSlotProps) => unknown;
  input?: (props: CopilotSidebarWelcomeScreenInputSlotProps) => unknown;
  "suggestion-view"?: (props: CopilotSidebarWelcomeScreenSuggestionViewSlotProps) => unknown;
  "welcome-screen"?: (props: CopilotChatWelcomeScreenSlotProps) => unknown;
  "welcome-message"?: () => unknown;
}>();

defineEmits<{
  "submit-message": [value: string];
  stop: [];
  "input-change": [value: string];
  "select-suggestion": [suggestion: import("@copilotkitnext/core").Suggestion, index: number];
  "add-file": [];
  "start-transcribe": [];
  "cancel-transcribe": [];
  "finish-transcribe": [];
}>();
</script>

<template>
  <CopilotChat
    v-bind="props"
    @submit-message="$emit('submit-message', $event)"
    @stop="$emit('stop')"
    @input-change="$emit('input-change', $event)"
    @select-suggestion="(suggestion, index) => $emit('select-suggestion', suggestion, index)"
    @add-file="$emit('add-file')"
    @start-transcribe="$emit('start-transcribe')"
    @cancel-transcribe="$emit('cancel-transcribe')"
    @finish-transcribe="$emit('finish-transcribe')"
  >
    <template #chat-view="slotProps">
      <slot v-if="$slots['chat-view']" name="chat-view" v-bind="slotProps" />
      <CopilotSidebarView
        v-else
        :messages="slotProps.messages"
        :auto-scroll="slotProps.autoScroll"
        :is-running="slotProps.isRunning"
        :suggestions="slotProps.suggestions"
        :suggestion-loading-indexes="slotProps.suggestionLoadingIndexes"
        :welcome-screen="slotProps.welcomeScreen"
        :input-value="slotProps.inputValue"
        :input-mode="slotProps.inputMode"
        :input-tools-menu="slotProps.inputToolsMenu"
        :width="width"
        :default-open="defaultOpen"
        :on-finish-transcribe-with-audio="slotProps.onFinishTranscribeWithAudio"
        v-bind="sidebarViewEventBindings(slotProps)"
      >
        <template v-if="$slots.header" #header="headerProps">
          <slot name="header" v-bind="headerProps" />
        </template>

        <template v-if="$slots['toggle-button']" #toggle-button="toggleButtonProps">
          <slot name="toggle-button" v-bind="toggleButtonProps" />
        </template>

        <template #welcome-screen="welcomeScreenProps">
          <slot v-if="$slots['welcome-screen']" name="welcome-screen" v-bind="welcomeScreenProps" />
          <CopilotSidebarWelcomeScreen v-else v-bind="welcomeScreenProps">
            <template v-if="$slots['welcome-message']" #welcome-message>
              <slot name="welcome-message" />
            </template>

            <template v-if="$slots['suggestion-view']" #suggestion-view="suggestionViewProps">
              <slot name="suggestion-view" v-bind="suggestionViewProps" />
            </template>

            <template v-if="$slots.input" #input="inputProps">
              <slot name="input" v-bind="inputProps" />
            </template>
          </CopilotSidebarWelcomeScreen>
        </template>

        <template v-if="$slots['message-view']" #message-view="messageViewProps">
          <slot name="message-view" v-bind="messageViewProps" />
        </template>

        <template v-if="$slots.input" #input="inputProps">
          <slot name="input" v-bind="inputProps" />
        </template>

        <template v-if="$slots['suggestion-view']" #suggestion-view="suggestionViewProps">
          <slot name="suggestion-view" v-bind="suggestionViewProps" />
        </template>
      </CopilotSidebarView>
    </template>
  </CopilotChat>
</template>
