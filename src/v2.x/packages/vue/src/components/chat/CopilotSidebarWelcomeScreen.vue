<script setup lang="ts">
import { computed } from "vue";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import CopilotChatInput from "./CopilotChatInput.vue";
import CopilotChatSuggestionView from "./CopilotChatSuggestionView.vue";
import type {
  CopilotSidebarWelcomeScreenInputSlotProps,
  CopilotSidebarWelcomeScreenLayoutSlotProps,
  CopilotSidebarWelcomeScreenProps,
  CopilotSidebarWelcomeScreenSuggestionViewSlotProps,
} from "./types";

const props = withDefaults(defineProps<CopilotSidebarWelcomeScreenProps>(), {
  suggestions: () => [],
  loadingIndexes: () => [],
  modelValue: "",
  isRunning: false,
  inputMode: "input",
  inputToolsMenu: () => [],
  onAddFile: undefined,
  onStartTranscribe: undefined,
  onCancelTranscribe: undefined,
  onFinishTranscribe: undefined,
  onFinishTranscribeWithAudio: undefined,
});

defineSlots<{
  "welcome-message"?: () => unknown;
  input?: (props: CopilotSidebarWelcomeScreenInputSlotProps) => unknown;
  "suggestion-view"?: (props: CopilotSidebarWelcomeScreenSuggestionViewSlotProps) => unknown;
  layout?: (props: CopilotSidebarWelcomeScreenLayoutSlotProps) => unknown;
}>();

const config = useCopilotChatConfiguration();
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);

const inputSlotProps = computed<CopilotSidebarWelcomeScreenInputSlotProps>(() => ({
  modelValue: props.modelValue,
  isRunning: props.isRunning,
  inputMode: props.inputMode,
  inputToolsMenu: props.inputToolsMenu,
  onUpdateModelValue: props.onUpdateModelValue,
  onSubmitMessage: props.onSubmitMessage,
  onStop: props.onStop,
  onAddFile: props.onAddFile,
  onStartTranscribe: props.onStartTranscribe,
  onCancelTranscribe: props.onCancelTranscribe,
  onFinishTranscribe: props.onFinishTranscribe,
  onFinishTranscribeWithAudio: props.onFinishTranscribeWithAudio,
}));
const suggestionViewSlotProps = computed<CopilotSidebarWelcomeScreenSuggestionViewSlotProps>(() => ({
  suggestions: props.suggestions,
  loadingIndexes: props.loadingIndexes,
  onSelectSuggestion: props.onSelectSuggestion,
}));
const layoutSlotProps = computed<CopilotSidebarWelcomeScreenLayoutSlotProps>(() => ({
  ...inputSlotProps.value,
  ...suggestionViewSlotProps.value,
}));

const inputEventProps = computed(() => {
  const listeners: Record<string, unknown> = {
    "onUpdate:modelValue": props.onUpdateModelValue,
    onSubmitMessage: props.onSubmitMessage,
    onStop: props.onStop,
  };

  if (props.onAddFile) {
    listeners.onAddFile = props.onAddFile;
  }
  if (props.onStartTranscribe) {
    listeners.onStartTranscribe = props.onStartTranscribe;
  }
  if (props.onCancelTranscribe) {
    listeners.onCancelTranscribe = props.onCancelTranscribe;
  }
  if (props.onFinishTranscribe) {
    listeners.onFinishTranscribe = props.onFinishTranscribe;
  }
  if (props.onFinishTranscribeWithAudio) {
    listeners.onFinishTranscribeWithAudio = props.onFinishTranscribeWithAudio;
  }

  return listeners;
});
</script>

<template>
  <slot name="layout" v-bind="layoutSlotProps">
    <div
      class="h-full flex flex-col"
      data-testid="copilot-sidebar-welcome-screen"
    >
      <div class="flex-1 flex flex-col items-center justify-center px-4">
        <slot name="welcome-message">
          <h1 class="text-xl sm:text-2xl font-medium text-foreground text-center">
            {{ labels.welcomeMessageText }}
          </h1>
        </slot>
      </div>

      <div class="px-8 pb-4">
        <div class="max-w-3xl mx-auto">
          <div class="mb-4 flex justify-center">
            <slot name="suggestion-view" v-bind="suggestionViewSlotProps">
              <CopilotChatSuggestionView
                :suggestions="suggestions"
                :loading-indexes="loadingIndexes"
                @select-suggestion="onSelectSuggestion"
              />
            </slot>
          </div>

          <slot name="input" v-bind="inputSlotProps">
            <CopilotChatInput
              :model-value="modelValue"
              :is-running="isRunning"
              :mode="inputMode"
              :tools-menu="inputToolsMenu"
              positioning="static"
              :show-disclaimer="true"
              v-bind="inputEventProps"
            />
          </slot>
        </div>
      </div>
    </div>
  </slot>
</template>
