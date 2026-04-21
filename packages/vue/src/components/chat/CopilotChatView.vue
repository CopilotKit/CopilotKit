<script setup lang="ts">
import {
  computed,
  getCurrentInstance,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useSlots,
  watch,
} from "vue";
import type { Message } from "@ag-ui/core";
import type { Suggestion } from "@copilotkit/core";
import type { Attachment } from "@copilotkit/shared";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import { IconChevronDown } from "../icons";
import CopilotChatInput from "./CopilotChatInput.vue";
import CopilotChatAttachmentQueue from "./CopilotChatAttachmentQueue.vue";
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

const props = withDefaults(defineProps<CopilotChatViewProps>(), {
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
});

defineSlots<{
  "message-view"?: (props: {
    messages: Message[];
    isRunning: boolean;
  }) => unknown;
  "scroll-view"?: (props: {
    messages: Message[];
    isRunning: boolean;
    suggestions: Suggestion[];
    loadingIndexes: ReadonlyArray<number>;
    messagePaddingBottom: string;
    showScrollToBottomButton: boolean;
    onSelectSuggestion: (suggestion: Suggestion, index: number) => void;
    onScroll: () => void;
    scrollToBottom: () => void;
  }) => unknown;
  feather?: () => unknown;
  "scroll-to-bottom-button"?: (props: { onClick: () => void }) => unknown;
  interrupt?: (props: CopilotChatInterruptSlotProps) => unknown;
  input?: (props: {
    modelValue: string;
    isRunning: boolean;
    inputMode: CopilotChatInputMode;
    inputToolsMenu: (ToolsMenuItem | "-")[];
    attachments: Attachment[];
    onUpdateModelValue: (value: string) => void;
    onSubmitMessage: (value: string) => void;
    onStop?: () => void;
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
    attachments: Attachment[];
    modelValue: string;
    isRunning: boolean;
    inputMode: CopilotChatInputMode;
    inputToolsMenu: (ToolsMenuItem | "-")[];
    onUpdateModelValue: (value: string) => void;
    onSubmitMessage: (value: string) => void;
    onStop?: () => void;
    onAddFile: () => void;
    onStartTranscribe: () => void;
    onCancelTranscribe: () => void;
    onFinishTranscribe: () => void;
    onFinishTranscribeWithAudio: (audioBlob: Blob) => void | Promise<void>;
    onSelectSuggestion: (suggestion: Suggestion, index: number) => void;
  }) => unknown;
  "welcome-message"?: () => unknown;
  [key: string]: ((props: any) => unknown) | undefined;
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
const componentSlots = useSlots();

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
const hasAttachments = computed(
  () => Array.isArray(props.attachments) && props.attachments.length > 0,
);
const vnodeProps = computed(
  () => (instance?.vnode.props ?? {}) as Record<string, unknown>,
);
const forwardedMessageViewSlotNames = computed(() =>
  Object.keys(componentSlots).filter(
    (slotName) =>
      slotName !== "message-view" &&
      slotName !== "scroll-view" &&
      slotName !== "feather" &&
      slotName !== "scroll-to-bottom-button" &&
      slotName !== "input" &&
      slotName !== "suggestion-view" &&
      slotName !== "welcome-screen" &&
      slotName !== "welcome-message",
  ),
);
const shouldShowWelcomeScreen = computed(
  () => props.messages.length === 0 && props.welcomeScreen !== false,
);
const hasAddFileAction = computed(() => hasListener("onAddFile"));
const hasStopAction = computed(() => hasListener("onStop"));
const hasStartTranscribeAction = computed(() =>
  hasListener("onStartTranscribe"),
);
const hasCancelTranscribeAction = computed(() =>
  hasListener("onCancelTranscribe"),
);
const hasFinishTranscribeAction = computed(() =>
  hasListener("onFinishTranscribe"),
);
const hasFinishTranscribeWithAudioAction = computed(
  () => typeof props.onFinishTranscribeWithAudio === "function",
);
const messagePaddingBottom = computed(
  () =>
    `${inputContainerHeight.value + FEATHER_HEIGHT + (hasSuggestions.value || hasAttachments.value ? 4 : 32)}px`,
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

  const distance =
    element.scrollHeight - element.scrollTop - element.clientHeight;
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

function handleDragOver(event: DragEvent) {
  props.onDragOver?.(event);
}

function handleDragLeave(event: DragEvent) {
  props.onDragLeave?.(event);
}

function handleDrop(event: DragEvent) {
  void props.onDrop?.(event);
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
  };

  if (hasStopAction.value) {
    listeners.onStop = handleStop;
  }
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
    data-copilotkit
    class="cpk:relative cpk:h-full"
    data-testid="copilot-chat-view"
    v-bind="$attrs"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <div
      v-if="dragOver"
      class="cpk:absolute cpk:inset-0 cpk:z-50 cpk:pointer-events-none cpk:flex cpk:items-center cpk:justify-center cpk:bg-primary/5 cpk:border-2 cpk:border-dashed cpk:border-primary/40 cpk:rounded-lg cpk:m-2"
      data-testid="copilot-chat-drop-overlay"
    >
      <span class="cpk:text-sm cpk:font-medium cpk:text-primary/70">
        Drop files here
      </span>
    </div>
    <slot
      v-if="shouldShowWelcomeScreen"
      name="welcome-screen"
      :suggestions="suggestions"
      :loading-indexes="suggestionLoadingIndexes"
      :attachments="attachments ?? []"
      :model-value="resolvedInputValue"
      :is-running="isRunning"
      :input-mode="inputMode"
      :input-tools-menu="inputToolsMenu"
      :on-update-model-value="handleInputValueChange"
      :on-submit-message="handleSubmitMessage"
      :on-stop="hasStopAction ? handleStop : undefined"
      :on-add-file="handleAddFile"
      :on-start-transcribe="handleStartTranscribe"
      :on-cancel-transcribe="handleCancelTranscribe"
      :on-finish-transcribe="handleFinishTranscribe"
      :on-finish-transcribe-with-audio="handleFinishTranscribeWithAudio"
      :on-select-suggestion="handleSelectSuggestion"
    >
      <div
        class="cpk:flex cpk:h-full cpk:flex-col cpk:items-center cpk:justify-center cpk:px-4"
        data-testid="copilot-chat-view-welcome-screen"
      >
        <div
          class="cpk:w-full cpk:max-w-3xl cpk:flex cpk:flex-col cpk:items-center"
        >
          <div class="cpk:mb-6">
            <slot name="welcome-message">
              <h1
                class="cpk:text-xl cpk:sm:text-2xl cpk:font-medium cpk:text-foreground cpk:text-center"
              >
                {{ labels.welcomeMessageText }}
              </h1>
            </slot>
          </div>

          <div class="cpk:w-full">
            <CopilotChatAttachmentQueue
              v-if="hasAttachments"
              :attachments="attachments ?? []"
              class-name="cpk:mb-2"
              @remove-attachment="
                (id: string) => onRemoveAttachment && onRemoveAttachment(id)
              "
            />
            <slot
              name="input"
              :model-value="resolvedInputValue"
              :is-running="isRunning"
              :input-mode="inputMode"
              :input-tools-menu="inputToolsMenu"
              :attachments="attachments ?? []"
              :on-update-model-value="handleInputValueChange"
              :on-submit-message="handleSubmitMessage"
              :on-stop="hasStopAction ? handleStop : undefined"
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

          <div
            v-if="hasSuggestions"
            class="cpk:mt-4 cpk:flex cpk:justify-center"
          >
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
      <slot
        name="scroll-view"
        :messages="messages"
        :is-running="isRunning"
        :suggestions="suggestions"
        :loading-indexes="suggestionLoadingIndexes"
        :message-padding-bottom="messagePaddingBottom"
        :show-scroll-to-bottom-button="showScrollToBottomButton"
        :on-select-suggestion="handleSelectSuggestion"
        :on-scroll="handleScroll"
        :scroll-to-bottom="scrollToBottom"
      >
        <div
          ref="scrollContainerRef"
          data-testid="copilot-chat-view-scroll"
          class="cpk:h-full cpk:max-h-full cpk:min-h-0 cpk:overflow-y-scroll cpk:overflow-x-hidden cpk:relative"
          @scroll="handleScroll"
        >
          <div
            class="cpk:px-4 cpk:sm:px-0 cpk:[div[data-sidebar-chat]_&]:px-8 cpk:[div[data-popup-chat]_&]:px-6"
          >
            <div
              ref="scrollContentRef"
              :style="{ paddingBottom: messagePaddingBottom }"
            >
              <div class="cpk:max-w-3xl cpk:mx-auto">
                <slot
                  name="message-view"
                  :messages="messages"
                  :is-running="isRunning"
                >
                  <CopilotChatMessageView
                    :messages="messages"
                    :is-running="isRunning"
                  >
                    <template
                      v-for="slotName in forwardedMessageViewSlotNames"
                      :key="slotName"
                      #[slotName]="slotProps"
                    >
                      <slot :name="slotName" v-bind="slotProps" />
                    </template>
                  </CopilotChatMessageView>
                </slot>
                <div
                  v-if="hasSuggestions"
                  class="cpk:mt-4 cpk:pl-0 cpk:pr-4 cpk:sm:px-0"
                >
                  <slot
                    name="suggestion-view"
                    :suggestions="suggestions"
                    :loading-indexes="suggestionLoadingIndexes"
                    :on-select-suggestion="handleSelectSuggestion"
                  >
                    <CopilotChatSuggestionView
                      class="cpk:mb-3 cpk:lg:ml-4 cpk:lg:mr-4 cpk:ml-0 cpk:mr-0"
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
      </slot>

      <slot name="feather">
        <div
          class="cpk:absolute cpk:bottom-0 cpk:left-0 cpk:right-4 cpk:h-24 cpk:pointer-events-none cpk:z-10 cpk:bg-gradient-to-t cpk:from-white cpk:via-white cpk:to-transparent cpk:dark:from-[rgb(33,33,33)] cpk:dark:via-[rgb(33,33,33)]"
          data-testid="copilot-chat-view-feather"
        />
      </slot>

      <div
        v-if="showScrollToBottomButton"
        class="cpk:absolute cpk:inset-x-0 cpk:flex cpk:justify-center cpk:z-30 cpk:pointer-events-none"
        :style="{ bottom: `${inputContainerHeight + FEATHER_HEIGHT + 16}px` }"
      >
        <slot name="scroll-to-bottom-button" :on-click="() => scrollToBottom()">
          <button
            type="button"
            data-testid="copilot-chat-view-scroll-to-bottom"
            class="cpk:rounded-full cpk:w-10 cpk:h-10 cpk:p-0 cpk:pointer-events-auto cpk:bg-white cpk:dark:bg-gray-900 cpk:shadow-lg cpk:border cpk:border-gray-200 cpk:dark:border-gray-700 cpk:hover:bg-gray-50 cpk:dark:hover:bg-gray-800 cpk:flex cpk:items-center cpk:justify-center cpk:cursor-pointer"
            @click="scrollToBottom()"
          >
            <IconChevronDown
              class="cpk:w-4 cpk:h-4 cpk:text-gray-600 cpk:dark:text-white"
            />
          </button>
        </slot>
      </div>

      <div class="cpk:max-w-3xl cpk:mx-auto cpk:w-full">
        <CopilotChatAttachmentQueue
          v-if="hasAttachments"
          :attachments="attachments ?? []"
          class-name="cpk:px-4"
          @remove-attachment="
            (id: string) => onRemoveAttachment && onRemoveAttachment(id)
          "
        />
      </div>

      <div
        ref="inputContainerRef"
        class="cpk:absolute cpk:bottom-0 cpk:left-0 cpk:right-0 cpk:z-20 cpk:pointer-events-none"
        data-testid="copilot-chat-view-input-container"
      >
        <slot
          name="input"
          :model-value="resolvedInputValue"
          :is-running="isRunning"
          :input-mode="inputMode"
          :input-tools-menu="inputToolsMenu"
          :attachments="attachments ?? []"
          :on-update-model-value="handleInputValueChange"
          :on-submit-message="handleSubmitMessage"
          :on-stop="hasStopAction ? handleStop : undefined"
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
