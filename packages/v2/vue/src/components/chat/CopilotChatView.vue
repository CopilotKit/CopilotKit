<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { Message } from "@ag-ui/core";
import type { Suggestion } from "@copilotkitnext/core";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import { IconChevronDown } from "../icons";
import CopilotChatInput from "./CopilotChatInput.vue";
import CopilotChatMessageView from "./CopilotChatMessageView.vue";
import CopilotChatSuggestionView from "./CopilotChatSuggestionView.vue";
import type {
  CopilotChatInputMode,
  CopilotChatInterruptSlotProps,
  CopilotChatViewProps,
  ToolsMenuItem,
} from "./types";

const FEATHER_HEIGHT = 96;
const SCROLL_BOTTOM_THRESHOLD = 12;

const props = withDefaults(
  defineProps<CopilotChatViewProps>(),
  {
    messages: () => [],
    autoScroll: true,
    isRunning: false,
    suggestions: () => [],
    suggestionLoadingIndexes: () => [],
    welcomeScreen: true,
    inputValue: undefined,
    inputMode: "input",
    inputToolsMenu: () => [],
    onFinishTranscribeWithAudio: undefined,
  },
);

defineSlots<{
  "message-view"?: (props: { messages: Message[]; isRunning: boolean }) => unknown;
  interrupt?: (props: CopilotChatInterruptSlotProps) => unknown;
  input?: (props: {
    modelValue: string;
    isRunning: boolean;
    inputMode: CopilotChatInputMode;
    inputToolsMenu: (ToolsMenuItem | "-")[];
    onUpdateModelValue: (value: string) => void;
    onSubmitMessage: (value: string) => void;
    onStop: () => void;
    onAddFile: () => void;
    onStartTranscribe: () => void;
    onCancelTranscribe: () => void;
    onFinishTranscribe: () => void;
    onFinishTranscribeWithAudio: (audioBlob: Blob) => void | Promise<void>;
  }) => unknown;
  "suggestion-view"?: (props: {
    suggestions: Suggestion[];
    loadingIndexes: ReadonlyArray<number>;
    onSelectSuggestion: (suggestion: Suggestion, index: number) => void;
  }) => unknown;
  "welcome-screen"?: (props: {
    suggestions: Suggestion[];
    loadingIndexes: ReadonlyArray<number>;
    modelValue: string;
    isRunning: boolean;
    inputMode: CopilotChatInputMode;
    inputToolsMenu: (ToolsMenuItem | "-")[];
    onUpdateModelValue: (value: string) => void;
    onSubmitMessage: (value: string) => void;
    onStop: () => void;
    onAddFile: () => void;
    onStartTranscribe: () => void;
    onCancelTranscribe: () => void;
    onFinishTranscribe: () => void;
    onFinishTranscribeWithAudio: (audioBlob: Blob) => void | Promise<void>;
    onSelectSuggestion: (suggestion: Suggestion, index: number) => void;
  }) => unknown;
  "welcome-message"?: () => unknown;
}>();

const emit = defineEmits<{
  "submit-message": [value: string];
  stop: [];
  "input-change": [value: string];
  "select-suggestion": [suggestion: Suggestion, index: number];
  "add-file": [];
  "start-transcribe": [];
  "cancel-transcribe": [];
  "finish-transcribe": [];
}>();

const config = useCopilotChatConfiguration();
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);
const instance = getCurrentInstance();

const scrollContainerRef = ref<HTMLElement | null>(null);
const scrollContentRef = ref<HTMLElement | null>(null);
const inputContainerRef = ref<HTMLElement | null>(null);
const inputContainerHeight = ref(0);
const isAtBottom = ref(true);
const isControlledInput = computed(() => props.inputValue !== undefined);
const localInputValue = ref(props.inputValue ?? "");

const resolvedInputValue = computed(() =>
  isControlledInput.value ? (props.inputValue ?? "") : localInputValue.value,
);
const hasSuggestions = computed(
  () => Array.isArray(props.suggestions) && props.suggestions.length > 0,
);
const vnodeProps = computed(
  () => (instance?.vnode.props ?? {}) as Record<string, unknown>,
);
const shouldShowWelcomeScreen = computed(
  () => props.messages.length === 0 && props.welcomeScreen !== false,
);
const hasAddFileAction = computed(() => hasListener("onAddFile"));
const hasStartTranscribeAction = computed(() => hasListener("onStartTranscribe"));
const hasCancelTranscribeAction = computed(() => hasListener("onCancelTranscribe"));
const hasFinishTranscribeAction = computed(() => hasListener("onFinishTranscribe"));
const hasFinishTranscribeWithAudioAction = computed(
  () => typeof props.onFinishTranscribeWithAudio === "function",
);
const messagePaddingBottom = computed(
  () => `${inputContainerHeight.value + FEATHER_HEIGHT + (hasSuggestions.value ? 4 : 32)}px`,
);
const showScrollToBottomButton = computed(
  () => !shouldShowWelcomeScreen.value && !isAtBottom.value,
);

let inputResizeObserver: ResizeObserver | null = null;
let contentResizeObserver: ResizeObserver | null = null;

watch(
  () => props.inputValue,
  (next) => {
    if (isControlledInput.value) {
      localInputValue.value = next ?? "";
    }
  },
);

watch(
  [() => props.messages, () => props.suggestions, () => props.isRunning],
  async () => {
    const wasAtBottom = isAtBottom.value;
    await nextTick();
    if (!props.autoScroll || !wasAtBottom) {
      return;
    }
    scrollToBottom("auto");
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        scrollToBottom("auto");
      });
    }
  },
  { deep: true },
);

function updateIsAtBottom() {
  const element = scrollContainerRef.value;
  if (!element) {
    isAtBottom.value = true;
    return;
  }

  const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
  isAtBottom.value = distance <= SCROLL_BOTTOM_THRESHOLD;
}

function syncInputContainerHeight() {
  const element = inputContainerRef.value;
  inputContainerHeight.value = element?.offsetHeight ?? 0;
}

function scrollToBottom(behavior: ScrollBehavior = "smooth") {
  const element = scrollContainerRef.value;
  if (!element) return;

  if (typeof element.scrollTo === "function") {
    element.scrollTo({
      top: element.scrollHeight,
      behavior,
    });
  } else {
    element.scrollTop = element.scrollHeight;
  }
  updateIsAtBottom();
}

function handleScroll() {
  updateIsAtBottom();
}

function hasListener(listenerName: string) {
  const listener = vnodeProps.value[listenerName];
  if (Array.isArray(listener)) {
    return listener.length > 0;
  }
  return !!listener;
}

function handleInputValueChange(value: string) {
  if (!isControlledInput.value) {
    localInputValue.value = value;
  }
  emit("input-change", value);
}

function handleSubmitMessage(value: string) {
  emit("submit-message", value);
}

function handleStop() {
  emit("stop");
}

function handleSelectSuggestion(suggestion: Suggestion, index: number) {
  emit("select-suggestion", suggestion, index);
}

function handleAddFile() {
  emit("add-file");
}

function handleStartTranscribe() {
  emit("start-transcribe");
}

function handleCancelTranscribe() {
  emit("cancel-transcribe");
}

function handleFinishTranscribe() {
  emit("finish-transcribe");
}

async function handleFinishTranscribeWithAudio(audioBlob: Blob) {
  await props.onFinishTranscribeWithAudio?.(audioBlob);
}

const inputEventProps = computed(() => {
  const listeners: Record<string, unknown> = {
    "onUpdate:modelValue": handleInputValueChange,
    onSubmitMessage: handleSubmitMessage,
    onStop: handleStop,
  };

  if (hasAddFileAction.value) {
    listeners.onAddFile = handleAddFile;
  }
  if (hasStartTranscribeAction.value) {
    listeners.onStartTranscribe = handleStartTranscribe;
  }
  if (hasCancelTranscribeAction.value) {
    listeners.onCancelTranscribe = handleCancelTranscribe;
  }
  if (hasFinishTranscribeAction.value) {
    listeners.onFinishTranscribe = handleFinishTranscribe;
  }
  if (hasFinishTranscribeWithAudioAction.value) {
    listeners.onFinishTranscribeWithAudio = handleFinishTranscribeWithAudio;
  }

  return listeners;
});

onMounted(async () => {
  await nextTick();
  syncInputContainerHeight();
  updateIsAtBottom();
  if (props.autoScroll) {
    scrollToBottom("auto");
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        scrollToBottom("auto");
      });
    }
  }

  if (typeof ResizeObserver !== "undefined" && inputContainerRef.value) {
    inputResizeObserver = new ResizeObserver(() => {
      const wasAtBottom = isAtBottom.value;
      syncInputContainerHeight();
      updateIsAtBottom();
      if (props.autoScroll && wasAtBottom) {
        scrollToBottom("auto");
      }
    });
    inputResizeObserver.observe(inputContainerRef.value);
  }

  if (typeof ResizeObserver !== "undefined" && scrollContentRef.value) {
    contentResizeObserver = new ResizeObserver(() => {
      const wasAtBottom = isAtBottom.value;
      updateIsAtBottom();
      if (props.autoScroll && wasAtBottom) {
        scrollToBottom("auto");
      }
    });
    contentResizeObserver.observe(scrollContentRef.value);
  }
});

onBeforeUnmount(() => {
  inputResizeObserver?.disconnect();
  contentResizeObserver?.disconnect();
  inputResizeObserver = null;
  contentResizeObserver = null;
});
</script>

<template>
  <div
    class="relative h-full"
    data-testid="copilot-chat-view"
    v-bind="$attrs"
  >
    <slot
      v-if="shouldShowWelcomeScreen"
      name="welcome-screen"
      :suggestions="suggestions"
      :loading-indexes="suggestionLoadingIndexes"
      :model-value="resolvedInputValue"
      :is-running="isRunning"
      :input-mode="inputMode"
      :input-tools-menu="inputToolsMenu"
      :on-update-model-value="handleInputValueChange"
      :on-submit-message="handleSubmitMessage"
      :on-stop="handleStop"
      :on-add-file="handleAddFile"
      :on-start-transcribe="handleStartTranscribe"
      :on-cancel-transcribe="handleCancelTranscribe"
      :on-finish-transcribe="handleFinishTranscribe"
      :on-finish-transcribe-with-audio="handleFinishTranscribeWithAudio"
      :on-select-suggestion="handleSelectSuggestion"
    >
      <div
        class="flex h-full flex-col items-center justify-center px-4"
        data-testid="copilot-chat-view-welcome-screen"
      >
        <div class="w-full max-w-3xl flex flex-col items-center">
          <div class="mb-6">
            <slot name="welcome-message">
              <h1 class="text-xl sm:text-2xl font-medium text-foreground text-center">
                {{ labels.welcomeMessageText }}
              </h1>
            </slot>
          </div>

          <div class="w-full">
            <slot
              name="input"
              :model-value="resolvedInputValue"
              :is-running="isRunning"
              :input-mode="inputMode"
              :input-tools-menu="inputToolsMenu"
              :on-update-model-value="handleInputValueChange"
              :on-submit-message="handleSubmitMessage"
              :on-stop="handleStop"
              :on-add-file="handleAddFile"
              :on-start-transcribe="handleStartTranscribe"
              :on-cancel-transcribe="handleCancelTranscribe"
              :on-finish-transcribe="handleFinishTranscribe"
              :on-finish-transcribe-with-audio="handleFinishTranscribeWithAudio"
            >
              <CopilotChatInput
                :model-value="resolvedInputValue"
                :is-running="isRunning"
                :mode="inputMode"
                :tools-menu="inputToolsMenu"
                positioning="static"
                :show-disclaimer="true"
                v-bind="inputEventProps"
              />
            </slot>
          </div>

          <div v-if="hasSuggestions" class="mt-4 flex justify-center">
            <slot
              name="suggestion-view"
              :suggestions="suggestions"
              :loading-indexes="suggestionLoadingIndexes"
              :on-select-suggestion="handleSelectSuggestion"
            >
              <CopilotChatSuggestionView
                :suggestions="suggestions"
                :loading-indexes="suggestionLoadingIndexes"
                @select-suggestion="handleSelectSuggestion"
              />
            </slot>
          </div>
        </div>
      </div>
    </slot>

    <template v-else>
      <div
        ref="scrollContainerRef"
        data-testid="copilot-chat-view-scroll"
        class="h-full max-h-full min-h-0 overflow-y-scroll overflow-x-hidden relative"
        @scroll="handleScroll"
      >
        <div class="px-4 sm:px-0 [div[data-sidebar-chat]_&]:px-8 [div[data-popup-chat]_&]:px-6">
          <div
            ref="scrollContentRef"
            :style="{ paddingBottom: messagePaddingBottom }"
          >
            <div class="max-w-3xl mx-auto">
              <slot name="message-view" :messages="messages" :is-running="isRunning">
                <CopilotChatMessageView
                  :messages="messages"
                  :is-running="isRunning"
                >
                  <template v-if="$slots.interrupt" #interrupt="slotProps">
                    <slot name="interrupt" v-bind="slotProps" />
                  </template>
                </CopilotChatMessageView>
              </slot>
              <div
                v-if="hasSuggestions"
                class="mt-4 pl-0 pr-4 sm:px-0"
              >
                <slot
                  name="suggestion-view"
                  :suggestions="suggestions"
                  :loading-indexes="suggestionLoadingIndexes"
                  :on-select-suggestion="handleSelectSuggestion"
                >
                  <CopilotChatSuggestionView
                    class="mb-3 lg:ml-4 lg:mr-4 ml-0 mr-0"
                    :suggestions="suggestions"
                    :loading-indexes="suggestionLoadingIndexes"
                    @select-suggestion="handleSelectSuggestion"
                  />
                </slot>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        class="absolute bottom-0 left-0 right-4 h-24 pointer-events-none z-10 bg-gradient-to-t from-white via-white to-transparent dark:from-[rgb(33,33,33)] dark:via-[rgb(33,33,33)]"
        data-testid="copilot-chat-view-feather"
      />

      <div
        v-if="showScrollToBottomButton"
        class="absolute inset-x-0 flex justify-center z-30 pointer-events-none"
        :style="{ bottom: `${inputContainerHeight + FEATHER_HEIGHT + 16}px` }"
      >
        <button
          type="button"
          data-testid="copilot-chat-view-scroll-to-bottom"
          class="rounded-full w-10 h-10 p-0 pointer-events-auto bg-white dark:bg-gray-900 shadow-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-center cursor-pointer"
          @click="scrollToBottom()"
        >
          <IconChevronDown class="w-4 h-4 text-gray-600 dark:text-white" />
        </button>
      </div>

      <div
        ref="inputContainerRef"
        class="absolute bottom-0 left-0 right-0 z-20 pointer-events-none"
        data-testid="copilot-chat-view-input-container"
      >
        <slot
          name="input"
          :model-value="resolvedInputValue"
          :is-running="isRunning"
          :input-mode="inputMode"
          :input-tools-menu="inputToolsMenu"
          :on-update-model-value="handleInputValueChange"
          :on-submit-message="handleSubmitMessage"
          :on-stop="handleStop"
          :on-add-file="handleAddFile"
          :on-start-transcribe="handleStartTranscribe"
          :on-cancel-transcribe="handleCancelTranscribe"
          :on-finish-transcribe="handleFinishTranscribe"
          :on-finish-transcribe-with-audio="handleFinishTranscribeWithAudio"
        >
          <CopilotChatInput
            :model-value="resolvedInputValue"
            :is-running="isRunning"
            :mode="inputMode"
            :tools-menu="inputToolsMenu"
            positioning="absolute"
            :show-disclaimer="true"
            v-bind="inputEventProps"
          />
        </slot>
      </div>
    </template>
  </div>
</template>
