<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useAttrs, watch } from "vue";
import {
  ɵPOPUP_DEFAULT_HEIGHT,
  ɵPOPUP_DEFAULT_WIDTH,
  ɵbindPopupDismiss,
  ɵcreateExitPresence,
  ɵdimensionToCss,
} from "@copilotkit/core";
import { CopilotChatDefaultLabels } from "../../providers/types";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import CopilotChatToggleButton from "./CopilotChatToggleButton.vue";
import CopilotChatView from "./CopilotChatView.vue";
import CopilotModalHeader from "./CopilotModalHeader.vue";
import { forwardedSlotNames } from "./forwarded-slots";
import type {
  CopilotChatFeatherSlotProps,
  CopilotChatInterruptSlotProps,
  CopilotChatMessageViewSlotProps,
  CopilotChatScrollToBottomButtonSlotProps,
  CopilotChatScrollViewSlotProps,
  CopilotChatWelcomeScreenSlotProps,
  CopilotPopupViewHeaderSlotProps,
  CopilotPopupViewProps,
  CopilotPopupViewToggleButtonSlotProps,
  CopilotSidebarWelcomeScreenInputSlotProps,
  CopilotSidebarWelcomeScreenSuggestionViewSlotProps,
} from "./types";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<Omit<CopilotPopupViewProps, "defaultOpen">>(),
  {
    messages: () => [],
    autoScroll: true,
    messageFeedback: true,
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
  },
);

defineSlots<{
  header?: (props: CopilotPopupViewHeaderSlotProps) => unknown;
  "toggle-button"?: (props: CopilotPopupViewToggleButtonSlotProps) => unknown;
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

// Slots this component renders itself. It passes every other slot to the
// chat view.
const OWN_SLOTS = ["header", "toggle-button"] as const;

const emit = defineEmits<{
  "submit-message": [value: string];
  stop: [];
  "input-change": [value: string];
  "select-suggestion": [
    suggestion: (typeof props.suggestions)[number],
    index: number,
  ];
  "add-file": [];
  "start-transcribe": [];
  "cancel-transcribe": [];
  "finish-transcribe": [];
}>();

const attrs = useAttrs();
const config = useCopilotChatConfiguration();

const containerRef = ref<HTMLElement | null>(null);
const isPopupOpen = computed(() => config.value?.isModalOpen ?? false);

// Core keeps the closed popup rendered while its exit animation plays.
const presence = ɵcreateExitPresence(isPopupOpen.value);
const isRendered = ref(presence.getState().isRendered);
const isAnimatingOut = ref(presence.getState().isClosing);
presence.subscribe((state) => {
  isRendered.value = state.isRendered;
  isAnimatingOut.value = state.isClosing;
});
watch(isPopupOpen, (open) => presence.setOpen(open));
onBeforeUnmount(() => presence.dispose());

const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);
const headerTitle = computed(() => labels.value.modalHeaderTitle);
const popupAnimationClass = computed(() =>
  isPopupOpen.value && !isAnimatingOut.value
    ? "cpk-popup-view-window-open"
    : undefined,
);
const popupStyle = computed(
  () =>
    ({
      "--copilot-popup-width": ɵdimensionToCss(
        props.width,
        ɵPOPUP_DEFAULT_WIDTH,
      ),
      "--copilot-popup-height": ɵdimensionToCss(
        props.height,
        ɵPOPUP_DEFAULT_HEIGHT,
      ),
      "--copilot-popup-max-width": "calc(100vw - 3rem)",
      "--copilot-popup-max-height": "calc(100dvh - 7.5rem)",
      paddingTop: "env(safe-area-inset-top)",
      paddingBottom: "env(safe-area-inset-bottom)",
      paddingLeft: "env(safe-area-inset-left)",
      paddingRight: "env(safe-area-inset-right)",
    }) as Record<string, string>,
);

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
    onInputChange: handleInputChange,
    onSelectSuggestion: handleSelectSuggestion,
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

  return listeners;
});

const chatViewBindings = computed(() => ({
  ...attrs,
  ...chatViewEventProps.value,
}));

// Escape, a click outside (when enabled), and focus once the popup opens.
watch(
  [isPopupOpen, () => props.clickOutsideToClose],
  ([open, clickOutsideToClose], _old, onCleanup) => {
    if (!open) {
      return;
    }
    onCleanup(
      ɵbindPopupDismiss({
        getContainer: () => containerRef.value,
        onDismiss: closePopup,
        clickOutsideToClose: clickOutsideToClose === true,
      }),
    );
  },
  { immediate: true },
);
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

  <div v-if="isRendered" data-copilotkit class="cpk-popup-view">
    <div
      ref="containerRef"
      tabindex="-1"
      role="dialog"
      :aria-label="labels.modalHeaderTitle"
      data-copilot-popup
      :class="[
        'copilotKitPopup copilotKitWindow cpk-popup-view-window',
        popupAnimationClass,
      ]"
      :style="popupStyle"
    >
      <slot
        name="header"
        :title="headerTitle"
        :on-close="closePopup"
        :is-open="isPopupOpen"
      >
        <CopilotModalHeader :title="headerTitle" />
      </slot>

      <div class="cpk-popup-view-chat" data-popup-chat>
        <CopilotChatView
          class="cpk-popup-view-chat-view"
          :messages="messages"
          :auto-scroll="autoScroll"
          :is-running="isRunning"
          :suggestions="suggestions"
          :suggestion-loading-indexes="suggestionLoadingIndexes"
          :welcome-screen="welcomeScreen"
          :input-value="inputValue"
          :input-mode="inputMode"
          :input-tools-menu="inputToolsMenu"
          :tool-call-display="toolCallDisplay"
          :message-feedback="messageFeedback"
          :on-finish-transcribe-with-audio="onFinishTranscribeWithAudio"
          v-bind="chatViewBindings"
        >
          <template
            v-for="slotName in forwardedSlotNames($slots, OWN_SLOTS)"
            :key="slotName"
            #[slotName]="slotProps"
          >
            <slot :name="slotName" v-bind="slotProps" />
          </template>
        </CopilotChatView>
      </div>
    </div>
  </div>
</template>
