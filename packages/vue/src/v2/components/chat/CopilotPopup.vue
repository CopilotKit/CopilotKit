<script setup lang="ts">
import { computed, watch } from "vue";
import CopilotChat from "./CopilotChat.vue";
import CopilotPopupView from "./CopilotPopupView.vue";
import CopilotPopupWelcomeScreen from "./CopilotPopupWelcomeScreen.vue";
import InlineFeatureWarning from "../InlineFeatureWarning.vue";
import { forwardedSlotNames } from "./forwarded-slots";
import { useLicenseContext } from "../../providers/useLicenseContext";
import type {
  CopilotChatFeatherSlotProps,
  CopilotChatInterruptSlotProps,
  CopilotChatMessageViewSlotProps,
  CopilotChatScrollToBottomButtonSlotProps,
  CopilotChatScrollViewSlotProps,
  CopilotChatViewOverrideSlotProps,
  CopilotChatWelcomeScreenSlotProps,
  CopilotPopupProps,
  CopilotPopupViewHeaderSlotProps,
  CopilotPopupViewToggleButtonSlotProps,
  CopilotSidebarWelcomeScreenInputSlotProps,
  CopilotSidebarWelcomeScreenSuggestionViewSlotProps,
} from "./types";
import type { Suggestion } from "@copilotkit/core";

function popupViewEventBindings(slotProps: CopilotChatViewOverrideSlotProps) {
  return {
    onSubmitMessage: slotProps.onSubmitMessage,
    onInputChange: slotProps.onInputChange,
    onSelectSuggestion: slotProps.onSelectSuggestion,
    ...(slotProps.canStop ? { onStop: slotProps.onStop } : {}),
    ...(slotProps.canAddFile ? { onAddFile: slotProps.onAddFile } : {}),
    ...(slotProps.canTranscribe
      ? {
          onStartTranscribe: slotProps.onStartTranscribe,
          onCancelTranscribe: slotProps.onCancelTranscribe,
          onFinishTranscribe: slotProps.onFinishTranscribe,
        }
      : {}),
  };
}

const props = withDefaults(defineProps<CopilotPopupProps>(), {
  autoScroll: true,
  welcomeScreen: true,
  inputValue: undefined,
  inputMode: "input",
  inputToolsMenu: () => [],
  width: undefined,
  height: undefined,
  clickOutsideToClose: false,
  defaultOpen: true,
  onFinishTranscribeWithAudio: undefined,
});

defineSlots<{
  header?: (props: CopilotPopupViewHeaderSlotProps) => unknown;
  "toggle-button"?: (props: CopilotPopupViewToggleButtonSlotProps) => unknown;
  "chat-view"?: (props: CopilotChatViewOverrideSlotProps) => unknown;
  "message-view"?: (props: CopilotChatMessageViewSlotProps) => unknown;
  "scroll-view"?: (props: CopilotChatScrollViewSlotProps) => unknown;
  feather?: (props: CopilotChatFeatherSlotProps) => unknown;
  "scroll-to-bottom-button"?: (
    props: CopilotChatScrollToBottomButtonSlotProps,
  ) => unknown;
  interrupt?: (props: CopilotChatInterruptSlotProps) => unknown;
  input?: (props: CopilotSidebarWelcomeScreenInputSlotProps) => unknown;
  "suggestion-view"?: (
    props: CopilotSidebarWelcomeScreenSuggestionViewSlotProps,
  ) => unknown;
  "welcome-screen"?: (props: CopilotChatWelcomeScreenSlotProps) => unknown;
  "welcome-message"?: () => unknown;
  // Any other slot goes to the chat view, as on CopilotChat.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: ((props: any) => unknown) | undefined;
}>();

// Slots this component renders itself. It passes every other slot to the view.
const OWN_SLOTS = ["chat-view", "welcome-screen", "welcome-message"] as const;

defineEmits<{
  "submit-message": [value: string];
  stop: [];
  "input-change": [value: string];
  "select-suggestion": [suggestion: Suggestion, index: number];
  "add-file": [];
  "start-transcribe": [];
  "cancel-transcribe": [];
  "finish-transcribe": [];
}>();

const license = useLicenseContext();
const isPopupLicensed = computed(() => license.value.checkFeature("popup"));

watch(
  isPopupLicensed,
  (licensed) => {
    if (!licensed) {
      console.warn(
        '[CopilotKit] Warning: "popup" feature is not licensed. Visit copilotkit.ai/pricing',
      );
    }
  },
  { immediate: true },
);
</script>

<template>
  <InlineFeatureWarning v-if="!isPopupLicensed" feature-name="Popup" />
  <CopilotChat
    v-bind="props"
    @submit-message="$emit('submit-message', $event)"
    @stop="$emit('stop')"
    @input-change="$emit('input-change', $event)"
    @select-suggestion="
      (suggestion, index) => $emit('select-suggestion', suggestion, index)
    "
    @add-file="$emit('add-file')"
    @start-transcribe="$emit('start-transcribe')"
    @cancel-transcribe="$emit('cancel-transcribe')"
    @finish-transcribe="$emit('finish-transcribe')"
  >
    <template #chat-view="slotProps">
      <slot v-if="$slots['chat-view']" name="chat-view" v-bind="slotProps" />
      <CopilotPopupView
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
        :height="height"
        :click-outside-to-close="clickOutsideToClose"
        :default-open="defaultOpen"
        :on-finish-transcribe-with-audio="slotProps.onFinishTranscribeWithAudio"
        v-bind="popupViewEventBindings(slotProps)"
      >
        <template
          v-for="slotName in forwardedSlotNames($slots, OWN_SLOTS)"
          :key="slotName"
          #[slotName]="forwardedProps"
        >
          <slot :name="slotName" v-bind="forwardedProps" />
        </template>

        <template #welcome-screen="welcomeScreenProps">
          <slot
            v-if="$slots['welcome-screen']"
            name="welcome-screen"
            v-bind="welcomeScreenProps"
          />
          <CopilotPopupWelcomeScreen v-else v-bind="welcomeScreenProps">
            <template v-if="$slots['welcome-message']" #welcome-message>
              <slot name="welcome-message" />
            </template>

            <template
              v-if="$slots['suggestion-view']"
              #suggestion-view="suggestionViewProps"
            >
              <slot name="suggestion-view" v-bind="suggestionViewProps" />
            </template>

            <template v-if="$slots.input" #input="inputProps">
              <slot name="input" v-bind="inputProps" />
            </template>
          </CopilotPopupWelcomeScreen>
        </template>
      </CopilotPopupView>
    </template>
  </CopilotChat>
</template>
