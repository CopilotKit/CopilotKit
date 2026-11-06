<script setup lang="ts">
import { computed, watch } from "vue";
import CopilotChat from "./CopilotChat.vue";
import CopilotSidebarView from "./CopilotSidebarView.vue";
import CopilotSidebarWelcomeScreen from "./CopilotSidebarWelcomeScreen.vue";
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
  CopilotSidebarProps,
  CopilotSidebarViewHeaderSlotProps,
  CopilotSidebarViewToggleButtonSlotProps,
  CopilotSidebarWelcomeScreenInputSlotProps,
  CopilotSidebarWelcomeScreenSuggestionViewSlotProps,
} from "./types";
import type { Suggestion } from "@copilotkit/core";

function sidebarViewEventBindings(slotProps: CopilotChatViewOverrideSlotProps) {
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

// Slots this component renders itself and does not pass to the view. It passes
// every other slot to the view. It also renders `input` and `suggestion-view`
// in its welcome screen, so those two go to both places.
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
const isSidebarLicensed = computed(() => license.value.checkFeature("sidebar"));

watch(
  isSidebarLicensed,
  (licensed) => {
    if (!licensed) {
      console.warn(
        '[CopilotKit] Warning: "sidebar" feature is not licensed. Visit copilotkit.ai/pricing',
      );
    }
  },
  { immediate: true },
);
</script>

<template>
  <InlineFeatureWarning v-if="!isSidebarLicensed" feature-name="Sidebar" />
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
          <CopilotSidebarWelcomeScreen v-else v-bind="welcomeScreenProps">
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
          </CopilotSidebarWelcomeScreen>
        </template>
      </CopilotSidebarView>
    </template>
  </CopilotChat>
</template>
