<script setup lang="ts">
import {
  computed,
  getCurrentInstance,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useAttrs,
  watch,
} from "vue";
import { CopilotChatDefaultLabels } from "../../providers/types";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import CopilotChatToggleButton from "./CopilotChatToggleButton.vue";
import CopilotChatView from "./CopilotChatView.vue";
import CopilotModalHeader from "./CopilotModalHeader.vue";
import type {
  CopilotChatMessageViewSlotProps,
  CopilotChatWelcomeScreenSlotProps,
  CopilotPopupViewHeaderSlotProps,
  CopilotPopupViewProps,
  CopilotPopupViewToggleButtonSlotProps,
  CopilotSidebarWelcomeScreenInputSlotProps,
  CopilotSidebarWelcomeScreenSuggestionViewSlotProps,
} from "./types";

defineOptions({ inheritAttrs: false });

const DEFAULT_POPUP_WIDTH = 420;
const DEFAULT_POPUP_HEIGHT = 560;
const POPUP_ANIMATION_MS = 200;

const props = withDefaults(defineProps<Omit<CopilotPopupViewProps, "defaultOpen">>(), {
  messages: () => [],
  autoScroll: true,
  isRunning: false,
  suggestions: () => [],
  suggestionLoadingIndexes: () => [],
  welcomeScreen: true,
  inputValue: undefined,
  inputMode: "input",
  inputToolsMenu: () => [],
  width: undefined,
  height: undefined,
  clickOutsideToClose: false,
  onFinishTranscribeWithAudio: undefined,
});

defineSlots<{
  header?: (props: CopilotPopupViewHeaderSlotProps) => unknown;
  "toggle-button"?: (props: CopilotPopupViewToggleButtonSlotProps) => unknown;
  "message-view"?: (props: CopilotChatMessageViewSlotProps) => unknown;
  input?: (props: CopilotSidebarWelcomeScreenInputSlotProps) => unknown;
  "suggestion-view"?: (props: CopilotSidebarWelcomeScreenSuggestionViewSlotProps) => unknown;
  "welcome-screen"?: (props: CopilotChatWelcomeScreenSlotProps) => unknown;
  "welcome-message"?: () => unknown;
}>();

const emit = defineEmits<{
  "submit-message": [value: string];
  stop: [];
  "input-change": [value: string];
  "select-suggestion": [suggestion: (typeof props.suggestions)[number], index: number];
  "add-file": [];
  "start-transcribe": [];
  "cancel-transcribe": [];
  "finish-transcribe": [];
}>();

const attrs = useAttrs();
const config = useCopilotChatConfiguration();
const instance = getCurrentInstance();
const vnodeProps = computed(() => (instance?.vnode.props ?? {}) as Record<string, unknown>);

const containerRef = ref<HTMLElement | null>(null);
const isRendered = ref(config.value?.isModalOpen ?? false);
const isAnimatingOut = ref(false);
let animationTimer: ReturnType<typeof setTimeout> | undefined;
let focusTimer: ReturnType<typeof setTimeout> | undefined;

const isPopupOpen = computed(() => config.value?.isModalOpen ?? false);
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);
const headerTitle = computed(() => labels.value.modalHeaderTitle);
const popupAnimationClass = computed(() =>
  isPopupOpen.value && !isAnimatingOut.value
    ? "pointer-events-auto translate-y-0 opacity-100 md:scale-100"
    : "pointer-events-none translate-y-4 opacity-0 md:translate-y-5 md:scale-[0.95]",
);
const popupStyle = computed(
  () =>
    ({
      "--copilot-popup-width": dimensionToCss(props.width, DEFAULT_POPUP_WIDTH),
      "--copilot-popup-height": dimensionToCss(props.height, DEFAULT_POPUP_HEIGHT),
      "--copilot-popup-max-width": "calc(100vw - 3rem)",
      "--copilot-popup-max-height": "calc(100dvh - 7.5rem)",
      width: "var(--copilot-popup-width)",
      height: "var(--copilot-popup-height)",
      maxWidth: "var(--copilot-popup-max-width)",
      maxHeight: "var(--copilot-popup-max-height)",
      paddingTop: "env(safe-area-inset-top)",
      paddingBottom: "env(safe-area-inset-bottom)",
      paddingLeft: "env(safe-area-inset-left)",
      paddingRight: "env(safe-area-inset-right)",
    }) as Record<string, string>,
);

function dimensionToCss(value: number | string | undefined, fallback: number): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}px`;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return `${fallback}px`;
}

function hasListener(listenerName: string) {
  const listener = vnodeProps.value[listenerName];
  if (Array.isArray(listener)) {
    return listener.length > 0;
  }
  return !!listener;
}

function closePopup() {
  config.value?.setModalOpen?.(false);
}

function openPopup() {
  config.value?.setModalOpen?.(true);
}

function togglePopup() {
  config.value?.setModalOpen?.(!isPopupOpen.value);
}

function handleSubmitMessage(value: string) {
  emit("submit-message", value);
}

function handleStop() {
  emit("stop");
}

function handleInputChange(value: string) {
  emit("input-change", value);
}

function handleSelectSuggestion(
  suggestion: (typeof props.suggestions)[number],
  index: number,
) {
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

const chatViewEventProps = computed(() => {
  const listeners: Record<string, unknown> = {
    onSubmitMessage: handleSubmitMessage,
    onStop: handleStop,
    onInputChange: handleInputChange,
    onSelectSuggestion: handleSelectSuggestion,
  };

  if (hasListener("onAddFile")) {
    listeners.onAddFile = handleAddFile;
  }
  if (hasListener("onStartTranscribe")) {
    listeners.onStartTranscribe = handleStartTranscribe;
  }
  if (hasListener("onCancelTranscribe")) {
    listeners.onCancelTranscribe = handleCancelTranscribe;
  }
  if (hasListener("onFinishTranscribe")) {
    listeners.onFinishTranscribe = handleFinishTranscribe;
  }

  return listeners;
});

const chatViewBindings = computed(() => ({
  ...attrs,
  ...chatViewEventProps.value,
}));

watch(
  isPopupOpen,
  (open) => {
    if (animationTimer) {
      clearTimeout(animationTimer);
      animationTimer = undefined;
    }

    if (open) {
      isRendered.value = true;
      isAnimatingOut.value = false;
      return;
    }

    if (!isRendered.value) {
      return;
    }

    isAnimatingOut.value = true;
    animationTimer = setTimeout(() => {
      isRendered.value = false;
      isAnimatingOut.value = false;
      animationTimer = undefined;
    }, POPUP_ANIMATION_MS);
  },
  { immediate: true },
);

watch(
  isPopupOpen,
  (open, _old, onCleanup) => {
    if (!open || typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePopup();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown);
    });
  },
  { immediate: true },
);

watch(
  isPopupOpen,
  (open, _old, onCleanup) => {
    if (!open) {
      return;
    }

    focusTimer = setTimeout(() => {
      const container = containerRef.value;
      if (container && !container.contains(document.activeElement)) {
        container.focus({ preventScroll: true });
      }
    }, POPUP_ANIMATION_MS);

    onCleanup(() => {
      if (focusTimer) {
        clearTimeout(focusTimer);
        focusTimer = undefined;
      }
    });
  },
  { immediate: true },
);

watch(
  [isPopupOpen, () => props.clickOutsideToClose],
  ([open, allowClose], _old, onCleanup) => {
    if (!open || !allowClose || typeof document === "undefined") {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      const container = containerRef.value;
      if (container?.contains(target)) {
        return;
      }

      const toggleButton = document.querySelector("[data-slot='chat-toggle-button']");
      if (toggleButton?.contains(target)) {
        return;
      }

      closePopup();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", handlePointerDown);
    });
  },
  { immediate: true },
);

onMounted(async () => {
  await nextTick();
});

onBeforeUnmount(() => {
  if (animationTimer) {
    clearTimeout(animationTimer);
  }
  if (focusTimer) {
    clearTimeout(focusTimer);
  }
});
</script>

<template>
  <slot
    name="toggle-button"
    :is-open="isPopupOpen"
    :toggle="togglePopup"
    :open="openPopup"
    :close="closePopup"
  >
    <CopilotChatToggleButton />
  </slot>

  <div
    v-if="isRendered"
    class="fixed inset-0 z-[1200] flex max-w-full flex-col items-stretch md:inset-auto md:bottom-24 md:right-6 md:items-end md:gap-4"
  >
    <div
      ref="containerRef"
      tabindex="-1"
      role="dialog"
      :aria-label="labels.modalHeaderTitle"
      data-copilot-popup
      :class="[
        'relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground',
        'origin-bottom focus:outline-none transform-gpu transition-transform transition-opacity duration-200 ease-out',
        'md:transition-transform md:transition-opacity',
        'rounded-none border border-border/0 shadow-none ring-0',
        'md:h-[var(--copilot-popup-height)] md:w-[var(--copilot-popup-width)]',
        'md:max-h-[var(--copilot-popup-max-height)] md:max-w-[var(--copilot-popup-max-width)]',
        'md:origin-bottom-right md:rounded-2xl md:border-border md:shadow-xl md:ring-1 md:ring-border/40',
        popupAnimationClass,
      ]"
      :style="popupStyle"
    >
      <slot name="header" :title="headerTitle" :on-close="closePopup" :is-open="isPopupOpen">
        <CopilotModalHeader :title="headerTitle" />
      </slot>

      <div class="flex-1 overflow-hidden" data-popup-chat>
        <CopilotChatView
          :messages="messages"
          :auto-scroll="autoScroll"
          :is-running="isRunning"
          :suggestions="suggestions"
          :suggestion-loading-indexes="suggestionLoadingIndexes"
          :welcome-screen="welcomeScreen"
          :input-value="inputValue"
          :input-mode="inputMode"
          :input-tools-menu="inputToolsMenu"
          :on-finish-transcribe-with-audio="onFinishTranscribeWithAudio"
          v-bind="chatViewBindings"
        >
          <template v-if="$slots['message-view']" #message-view="slotProps">
            <slot name="message-view" v-bind="slotProps" />
          </template>

          <template v-if="$slots.input" #input="slotProps">
            <slot name="input" v-bind="slotProps" />
          </template>

          <template v-if="$slots['suggestion-view']" #suggestion-view="slotProps">
            <slot name="suggestion-view" v-bind="slotProps" />
          </template>

          <template v-if="$slots['welcome-screen']" #welcome-screen="slotProps">
            <slot name="welcome-screen" v-bind="slotProps" />
          </template>

          <template v-if="$slots['welcome-message']" #welcome-message>
            <slot name="welcome-message" />
          </template>
        </CopilotChatView>
      </div>
    </div>
  </div>
</template>
