<script setup lang="ts">
import {
  computed,
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
import { useKeyboardHeight } from "../../hooks/use-keyboard-height";
import { usePinToSend } from "../../hooks/use-pin-to-send";
import { IconChevronDown } from "../icons";
import CopilotChatInput from "./CopilotChatInput.vue";
import CopilotChatAttachmentQueue from "./CopilotChatAttachmentQueue.vue";
import CopilotChatMessageView from "./CopilotChatMessageView.vue";
import CopilotChatSuggestionView from "./CopilotChatSuggestionView.vue";
import { normalizeAutoScroll } from "./normalize-auto-scroll";
import type {
  CopilotChatInputMode,
  CopilotChatInterruptSlotProps,
  CopilotChatViewProps,
  ToolsMenuItem,
} from "./types";

// Vertical gap between the scroll-to-bottom button and the input container.
// Mirrors React `CopilotChatView` `SCROLL_BUTTON_OFFSET`.
const SCROLL_BUTTON_OFFSET = 16;
const SCROLL_BOTTOM_THRESHOLD = 12;

const props = withDefaults(defineProps<CopilotChatViewProps>(), {
  messages: () => [],
  autoScroll: true,
  isRunning: false,
  suggestions: () => [],
  suggestionLoadingIndexes: () => [],
  welcomeScreen: true,
  introAnimation: true,
  inlineCursor: undefined,
  userMessageMarkdown: true,
  inputValue: undefined,
  inputMode: "input",
  inputToolsMenu: () => [],
  inputHighlightMarkdown: true,
  isConnecting: false,
  hasExplicitThreadId: false,
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
    canStop: boolean;
    canAddFile: boolean;
    canTranscribe: boolean;
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
    attachments: Attachment[];
    onRemoveAttachment?: (id: string) => void;
    modelValue: string;
    isRunning: boolean;
    inputMode: CopilotChatInputMode;
    inputToolsMenu: (ToolsMenuItem | "-")[];
    inputLayout?: "auto" | "stacked";
    inputHighlightMarkdown?: boolean;
    canStop: boolean;
    canAddFile: boolean;
    canTranscribe: boolean;
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
const componentSlots = useSlots();

const scrollContainerRef = ref<HTMLElement | null>(null);
const scrollContentRef = ref<HTMLElement | null>(null);
const spacerRef = ref<HTMLElement | null>(null);
const inputContainerRef = ref<HTMLElement | null>(null);
const inputContainerHeight = ref(0);
const isAtBottom = ref(true);
const isControlledInput = computed(() => props.inputValue !== undefined);
const localInputValue = ref(props.inputValue ?? "");

// Normalize the `autoScroll` prop into the canonical mode triplet
// (`pin-to-bottom` | `pin-to-send` | `none`). Boolean back-compat is
// preserved by `normalizeAutoScroll` (parity with React).
const autoScrollMode = computed(() => normalizeAutoScroll(props.autoScroll));
const isPinToBottomMode = computed(
  () => autoScrollMode.value === "pin-to-bottom",
);
const isPinToSendMode = computed(() => autoScrollMode.value === "pin-to-send");

// `usePinToSend` is always wired but bails internally when the spacer ref
// is null — i.e. unless `pin-to-send` mode is active and the spacer div
// has been mounted in the template.
usePinToSend({
  scrollRef: scrollContainerRef,
  contentRef: scrollContentRef,
  spacerRef,
  topOffset: 16,
});

// Track mobile keyboard state so the input can translate itself above the
// on-screen keyboard (matches React CopilotChatView behavior).
const { isKeyboardOpen, keyboardHeight } = useKeyboardHeight();
const effectiveKeyboardHeight = computed(() =>
  isKeyboardOpen.value ? keyboardHeight.value : 0,
);

const resolvedInputValue = computed(() =>
  isControlledInput.value ? (props.inputValue ?? "") : localInputValue.value,
);
const hasSuggestions = computed(
  () =>
    !props.isConnecting &&
    !props.isRunning &&
    Array.isArray(props.suggestions) &&
    props.suggestions.length > 0,
);
const hasAttachments = computed(
  () => Array.isArray(props.attachments) && props.attachments.length > 0,
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
  () =>
    props.messages.length === 0 &&
    props.welcomeScreen !== false &&
    !props.isConnecting &&
    !props.hasExplicitThreadId,
);
// Mirrors React: `paddingBottom = inputContainerHeight + 32`. Suggestions and
// the attachment queue live inside the input overlay, so their height is
// already captured by the overlay's measured `inputContainerHeight`.
const messagePaddingBottom = computed(
  () => `${inputContainerHeight.value + 32}px`,
);
const showScrollToBottomButton = computed(
  () => !shouldShowWelcomeScreen.value && !isAtBottom.value,
);

let inputResizeObserver: ResizeObserver | null = null;
let contentResizeObserver: ResizeObserver | null = null;

function attachInputOverlayObserver() {
  if (typeof ResizeObserver === "undefined") return;

  inputResizeObserver?.disconnect();
  inputResizeObserver = null;

  const el = inputContainerRef.value;
  if (!el) return;

  inputResizeObserver = new ResizeObserver((entries) => {
    const wasAtBottom = isAtBottom.value;
    const measured = entries[0]?.contentRect?.height;
    if (typeof measured === "number") {
      inputContainerHeight.value = measured;
    } else {
      syncInputContainerHeight();
    }
    updateIsAtBottom();
    if (isPinToBottomMode.value && wasAtBottom) {
      scrollToBottom("auto");
    }
  });
  inputResizeObserver.observe(el);
}

function attachScrollContentObserver() {
  if (typeof ResizeObserver === "undefined") return;

  contentResizeObserver?.disconnect();
  contentResizeObserver = null;

  const el = scrollContentRef.value;
  if (!el) return;

  contentResizeObserver = new ResizeObserver(() => {
    const wasAtBottom = isAtBottom.value;
    updateIsAtBottom();
    if (isPinToBottomMode.value && wasAtBottom) {
      scrollToBottom("auto");
    }
  });
  contentResizeObserver.observe(el);
}

// When the welcome screen disappears and the main chat view (with the input
// overlay) appears, the template-ref elements become non-null. Re-attach
// observers that were skipped during the initial mount.
watch(shouldShowWelcomeScreen, async (show) => {
  if (show) return;
  await nextTick();
  syncInputContainerHeight();
  attachInputOverlayObserver();
  attachScrollContentObserver();
});

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
    if (!isPinToBottomMode.value || !wasAtBottom) {
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
    onSubmitMessage: props.onSubmitMessage ? handleSubmitMessage : undefined,
  };

  if (props.onStop) {
    listeners.onStop = handleStop;
  }
  if (props.onAddFile) {
    listeners.onAddFile = handleAddFile;
  }
  if (props.onStartTranscribe) {
    listeners.onStartTranscribe = handleStartTranscribe;
  }
  if (props.onCancelTranscribe) {
    listeners.onCancelTranscribe = handleCancelTranscribe;
  }
  if (props.onFinishTranscribe) {
    listeners.onFinishTranscribe = handleFinishTranscribe;
  }
  if (props.onFinishTranscribeWithAudio) {
    listeners.onFinishTranscribeWithAudio = handleFinishTranscribeWithAudio;
  }

  return listeners;
});

const canStop = computed(() => !!props.onStop);
const canAddFile = computed(() => !!props.onAddFile);
const canTranscribe = computed(() => !!props.onStartTranscribe);

onMounted(async () => {
  await nextTick();
  syncInputContainerHeight();
  updateIsAtBottom();
  if (isPinToBottomMode.value) {
    scrollToBottom("auto");
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        scrollToBottom("auto");
      });
    }
  }

  attachInputOverlayObserver();
  attachScrollContentObserver();
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
    class="cpk:@container cpk:relative cpk:h-full"
    data-testid="copilot-chat-view"
    :data-intro="introAnimation ? '' : undefined"
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
      :on-remove-attachment="onRemoveAttachment"
      :model-value="resolvedInputValue"
      :is-running="isRunning"
      :input-mode="inputMode"
      :input-tools-menu="inputToolsMenu"
      :input-layout="inputLayout"
      :input-highlight-markdown="inputHighlightMarkdown"
      :can-stop="canStop"
      :can-add-file="canAddFile"
      :can-transcribe="canTranscribe"
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
        class="cpk:flex cpk:h-full cpk:flex-col cpk:items-center cpk:justify-center cpk:px-4"
        data-testid="copilot-chat-view-welcome-screen"
      >
        <div
          class="cpk:w-full cpk:max-w-3xl cpk:flex cpk:flex-col cpk:items-center"
        >
          <div class="cpk-intro cpk:mb-5">
            <slot name="welcome-message">
              <h1
                class="cpk:text-2xl cpk:@2xl:text-[1.75rem] cpk:font-semibold cpk:tracking-tight cpk:text-foreground cpk:text-center cpk:text-balance"
              >
                {{ labels.welcomeMessageText }}
              </h1>
            </slot>
          </div>

          <!-- Suggestion cards under the greeting, staggered in on mount -->
          <div
            v-if="hasSuggestions"
            class="cpk-intro-stagger cpk:mb-5 cpk:flex cpk:w-full cpk:justify-center cpk:empty:hidden"
          >
            <slot
              name="suggestion-view"
              :suggestions="suggestions"
              :loading-indexes="suggestionLoadingIndexes"
              :on-select-suggestion="handleSelectSuggestion"
            >
              <CopilotChatSuggestionView
                appearance="cards"
                :suggestions="suggestions"
                :loading-indexes="suggestionLoadingIndexes"
                @select-suggestion="handleSelectSuggestion"
              />
            </slot>
          </div>

          <div
            class="cpk-intro cpk:w-full"
            :style="{ '--cpk-intro-delay': '180ms' }"
          >
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
              :can-stop="canStop"
              :can-add-file="canAddFile"
              :can-transcribe="canTranscribe"
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
                :layout="inputLayout"
                :highlight-markdown="inputHighlightMarkdown"
                positioning="static"
                :show-disclaimer="true"
                :keyboard-height="effectiveKeyboardHeight"
                v-bind="inputEventProps"
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
            class="cpk:px-4 cpk:@3xl:px-0 cpk:[div[data-sidebar-chat]_&]:px-8 cpk:[div[data-popup-chat]_&]:px-6"
          >
            <div
              ref="scrollContentRef"
              data-testid="copilot-scroll-content"
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
                    :inline-cursor="inlineCursor"
                    :assistant-message-toolbar-scope="
                      assistantMessageToolbarScope
                    "
                    :user-message-markdown="userMessageMarkdown"
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
              </div>
            </div>
            <!--
              `pin-to-send` spacer. Sized to anchor the latest user message
              near the top of the viewport while the assistant streams a
              response. `usePinToSend` reads this ref and only activates
              when the spacer is present in the tree.
            -->
            <div
              v-if="isPinToSendMode"
              ref="spacerRef"
              data-pin-to-send-spacer
              aria-hidden="true"
              :style="{ height: '0px', flex: '0 0 auto' }"
            />
          </div>
        </div>
      </slot>

      <slot name="feather">
        <!--
          Default renders an empty div — no visual, but the element is
          still in the tree so a slot override / consumer styling can
          still apply (mirrors React `CopilotChatView.Feather`).
        -->
        <div data-testid="copilot-chat-view-feather" />
      </slot>

      <div
        v-if="showScrollToBottomButton"
        class="cpk:absolute cpk:inset-x-0 cpk:flex cpk:justify-center cpk:z-30 cpk:pointer-events-none"
        :style="{ bottom: `${inputContainerHeight + SCROLL_BUTTON_OFFSET}px` }"
      >
        <slot name="scroll-to-bottom-button" :on-click="() => scrollToBottom()">
          <button
            type="button"
            data-testid="copilot-chat-view-scroll-to-bottom"
            class="cpk:rounded-full cpk:size-9 cpk:p-0 cpk:pointer-events-auto cpk:border cpk:border-border cpk:bg-background cpk:text-foreground cpk:shadow-[0_2px_8px_-2px_rgb(0_0_0/0.12)] cpk:hover:bg-accent cpk:dark:bg-card cpk:dark:hover:bg-accent cpk:flex cpk:items-center cpk:justify-center cpk:cursor-pointer"
            @click="scrollToBottom()"
          >
            <IconChevronDown class="cpk:size-4" />
          </button>
        </slot>
      </div>

      <!--
        Input overlay. Mirrors React `CopilotChatView` `copilot-input-overlay`:
        absolutely positioned at the bottom, holds both the attachment queue
        and the chat input. The input itself uses `positioning="static"` so
        the overlay wrapper alone owns the absolute positioning, and the
        attachment queue is layered visually above the input via DOM order.
        The welcome-screen path intentionally does NOT use this overlay.
      -->
      <div
        ref="inputContainerRef"
        class="cpk:absolute cpk:bottom-0 cpk:left-0 cpk:right-0 cpk:z-20 cpk:pointer-events-none"
        data-testid="copilot-input-overlay"
      >
        <!--
          Messages fade out above the input and are fully hidden by the time
          they reach it, including the disclaimer area below.
        -->
        <div
          aria-hidden="true"
          class="cpk:pointer-events-none cpk:absolute cpk:inset-x-0 cpk:-top-6 cpk:bottom-0 cpk:-z-10 cpk:bg-[linear-gradient(to_bottom,transparent,var(--background)_1.5rem)]"
        />
        <!--
          In a conversation, suggestions sit in a scrollable row docked above
          the input. A custom `scroll-view` slot gets them as slot props
          instead, and renders them itself.
        -->
        <div
          v-if="hasSuggestions && !componentSlots['scroll-view']"
          class="cpk:max-w-3xl cpk:mx-auto cpk:w-full cpk:mb-1.5 cpk:px-4 cpk:@3xl:px-0 cpk:[div[data-sidebar-chat]_&]:px-8 cpk:[div[data-popup-chat]_&]:px-4 cpk:pointer-events-auto"
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
        <div
          v-if="hasAttachments"
          class="cpk:max-w-3xl cpk:mx-auto cpk:w-full cpk:pointer-events-auto"
        >
          <CopilotChatAttachmentQueue
            :attachments="attachments ?? []"
            class-name="cpk:px-4"
            @remove-attachment="
              (id: string) => onRemoveAttachment && onRemoveAttachment(id)
            "
          />
        </div>
        <slot
          name="input"
          :model-value="resolvedInputValue"
          :is-running="isRunning"
          :input-mode="inputMode"
          :input-tools-menu="inputToolsMenu"
          :attachments="attachments ?? []"
          :can-stop="canStop"
          :can-add-file="canAddFile"
          :can-transcribe="canTranscribe"
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
            :layout="inputLayout"
            :highlight-markdown="inputHighlightMarkdown"
            positioning="static"
            :show-disclaimer="true"
            :keyboard-height="effectiveKeyboardHeight"
            :bottom-anchored="true"
            v-bind="inputEventProps"
          />
        </slot>
      </div>
    </template>
  </div>
</template>
