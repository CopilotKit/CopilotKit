<script setup lang="ts">
import { computed } from "vue";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import CopilotChatAttachmentQueue from "./CopilotChatAttachmentQueue.vue";
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
  attachments: () => [],
  onRemoveAttachment: undefined,
  modelValue: "",
  isRunning: false,
  inputMode: "input",
  inputToolsMenu: () => [],
  canStop: undefined,
  canAddFile: undefined,
  canTranscribe: undefined,
  onAddFile: undefined,
  onStartTranscribe: undefined,
  onCancelTranscribe: undefined,
  onFinishTranscribe: undefined,
  onFinishTranscribeWithAudio: undefined,
});

defineSlots<{
  "welcome-message"?: () => unknown;
  input?: (props: CopilotSidebarWelcomeScreenInputSlotProps) => unknown;
  "suggestion-view"?: (
    props: CopilotSidebarWelcomeScreenSuggestionViewSlotProps,
  ) => unknown;
  layout?: (props: CopilotSidebarWelcomeScreenLayoutSlotProps) => unknown;
}>();

const config = useCopilotChatConfiguration();
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);

function handleStop() {
  props.onStop?.();
}

function handleAddFile() {
  props.onAddFile?.();
}

function handleStartTranscribe() {
  props.onStartTranscribe?.();
}

function handleCancelTranscribe() {
  props.onCancelTranscribe?.();
}

function handleFinishTranscribe() {
  props.onFinishTranscribe?.();
}

async function handleFinishTranscribeWithAudio(audioBlob: Blob) {
  await props.onFinishTranscribeWithAudio?.(audioBlob);
}

const inputSlotProps = computed<CopilotSidebarWelcomeScreenInputSlotProps>(
  () => ({
    modelValue: props.modelValue,
    isRunning: props.isRunning,
    inputMode: props.inputMode,
    inputToolsMenu: props.inputToolsMenu,
    canStop: props.canStop ?? Boolean(props.onStop),
    canAddFile: props.canAddFile ?? Boolean(props.onAddFile),
    canTranscribe: props.canTranscribe ?? Boolean(props.onStartTranscribe),
    onUpdateModelValue: props.onUpdateModelValue,
    onSubmitMessage: props.onSubmitMessage,
    onStop: handleStop,
    onAddFile: handleAddFile,
    onStartTranscribe: handleStartTranscribe,
    onCancelTranscribe: handleCancelTranscribe,
    onFinishTranscribe: handleFinishTranscribe,
    onFinishTranscribeWithAudio: handleFinishTranscribeWithAudio,
  }),
);
const suggestionViewSlotProps =
  computed<CopilotSidebarWelcomeScreenSuggestionViewSlotProps>(() => ({
    suggestions: props.suggestions,
    loadingIndexes: props.loadingIndexes,
    onSelectSuggestion: props.onSelectSuggestion,
  }));
const layoutSlotProps = computed<CopilotSidebarWelcomeScreenLayoutSlotProps>(
  () => ({
    ...inputSlotProps.value,
    ...suggestionViewSlotProps.value,
  }),
);

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
      data-copilotkit
      class="cpk:h-full cpk:flex cpk:flex-col"
      data-testid="copilot-sidebar-welcome-screen"
    >
      <!-- Greeting, suggestions and input, centered together -->
      <div
        class="cpk:flex-1 cpk:flex cpk:flex-col cpk:items-center cpk:justify-center cpk:gap-5 cpk:px-8 cpk:py-6"
      >
        <div class="cpk-intro">
          <slot name="welcome-message">
            <h1
              class="cpk:text-2xl cpk:@2xl:text-[1.75rem] cpk:font-semibold cpk:tracking-tight cpk:text-foreground cpk:text-center cpk:text-balance"
            >
              {{ labels.welcomeMessageText }}
            </h1>
          </slot>
        </div>
        <div
          class="cpk-intro-stagger cpk:flex cpk:w-full cpk:justify-center cpk:empty:hidden"
        >
          <slot name="suggestion-view" v-bind="suggestionViewSlotProps">
            <CopilotChatSuggestionView
              v-if="suggestions.length > 0"
              appearance="cards"
              :suggestions="suggestions"
              :loading-indexes="loadingIndexes"
              @select-suggestion="onSelectSuggestion"
            />
          </slot>
        </div>
        <div
          class="cpk-intro cpk:w-full"
          :style="{ '--cpk-intro-delay': '180ms' }"
        >
          <CopilotChatAttachmentQueue
            v-if="attachments.length > 0"
            :attachments="attachments"
            class-name="cpk:mb-2"
            @remove-attachment="(id: string) => onRemoveAttachment?.(id)"
          />
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
