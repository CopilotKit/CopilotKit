<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  useAttrs,
  watch,
} from "vue";
import {
  ɵSIDEBAR_DEFAULT_WIDTH,
  ɵSIDEBAR_TRANSITION_MS,
  ɵcreateDockedSidebar,
  ɵdimensionToCss,
  ɵwatchElementWidth,
} from "@copilotkit/core";
import type { ɵDockedSidebar } from "@copilotkit/core";
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
  CopilotSidebarWelcomeScreenInputSlotProps,
  CopilotSidebarWelcomeScreenSuggestionViewSlotProps,
  CopilotSidebarViewHeaderSlotProps,
  CopilotSidebarViewProps,
  CopilotSidebarViewToggleButtonSlotProps,
} from "./types";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<Omit<CopilotSidebarViewProps, "defaultOpen">>(),
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
    position: "right",
    onFinishTranscribeWithAudio: undefined,
  },
);

defineSlots<{
  header?: (props: CopilotSidebarViewHeaderSlotProps) => unknown;
  "toggle-button"?: (props: CopilotSidebarViewToggleButtonSlotProps) => unknown;
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

const sidebarRef = ref<HTMLElement | null>(null);
const measuredSidebarWidth = ref<number | string>(
  props.width ?? ɵSIDEBAR_DEFAULT_WIDTH,
);

const isSidebarOpen = computed(() => config.value?.isModalOpen ?? false);
const resolvedSidebarWidth = computed(
  () => props.width ?? measuredSidebarWidth.value,
);
const headerTitle = computed(
  () =>
    config.value?.labels.modalHeaderTitle ??
    CopilotChatDefaultLabels.modalHeaderTitle,
);
const asideClass = computed(() => [
  "copilotKitSidebar copilotKitWindow cpk-sidebar-view",
  // Slides off its edge when closed.
  !isSidebarOpen.value && "cpk-sidebar-view-closed",
  attrs.class,
]);
const asideAttrs = computed(() => {
  const { class: _className, ...rest } = attrs;
  return rest;
});
const asideStyle = computed(
  () =>
    ({
      "--sidebar-width": widthCss.value,
      paddingTop: "env(safe-area-inset-top)",
      paddingBottom: "env(safe-area-inset-bottom)",
    }) as Record<string, string>,
);
const widthCss = computed(() =>
  ɵdimensionToCss(resolvedSidebarWidth.value, ɵSIDEBAR_DEFAULT_WIDTH),
);

// The page makes room on the docked edge (desktop only).
let dock: ɵDockedSidebar | undefined;
watch(
  [isSidebarOpen, () => props.position, widthCss],
  ([open, position, width]) => {
    dock?.set({ open, position, width });
  },
);

function closeSidebar() {
  config.value?.setModalOpen?.(false);
}

function openSidebar() {
  config.value?.setModalOpen?.(true);
}

function toggleSidebar() {
  config.value?.setModalOpen?.(!isSidebarOpen.value);
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

// Without a `width` prop, the page margin follows the width the CSS gives
// the sidebar.
watch(
  [sidebarRef, () => props.width],
  ([element, width], _old, onCleanup) => {
    if (width !== undefined || !element) return;
    onCleanup(
      ɵwatchElementWidth(element, (next) => {
        measuredSidebarWidth.value = next;
      }),
    );
  },
  { flush: "post" },
);

onMounted(() => {
  dock = ɵcreateDockedSidebar(document, {
    transitionMs: ɵSIDEBAR_TRANSITION_MS,
  });
  dock.set({
    open: isSidebarOpen.value,
    position: props.position,
    width: widthCss.value,
  });
});

onBeforeUnmount(() => {
  dock?.dispose();
  dock = undefined;
});
</script>

<template>
  <slot
    name="toggle-button"
    :is-open="isSidebarOpen"
    :toggle="toggleSidebar"
    :open="openSidebar"
    :close="closeSidebar"
  >
    <CopilotChatToggleButton
      :class="
        position === 'left' ? 'cpk-sidebar-view-toggle-button-left' : undefined
      "
    />
  </slot>

  <aside
    ref="sidebarRef"
    data-copilotkit
    data-copilot-sidebar
    :data-position="position"
    :class="asideClass"
    :style="asideStyle"
    :aria-label="
      config?.labels.sidebarLabel ?? CopilotChatDefaultLabels.sidebarLabel
    "
    :aria-hidden="!isSidebarOpen"
    role="complementary"
    v-bind="asideAttrs"
  >
    <div class="cpk-sidebar-view-panel">
      <slot
        name="header"
        :title="headerTitle"
        :on-close="closeSidebar"
        :is-open="isSidebarOpen"
      >
        <CopilotModalHeader :title="headerTitle" />
      </slot>

      <div class="cpk-sidebar-view-chat" data-sidebar-chat>
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
          :tool-call-display="toolCallDisplay"
          :message-feedback="messageFeedback"
          :on-finish-transcribe-with-audio="onFinishTranscribeWithAudio"
          v-bind="chatViewEventProps"
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
  </aside>
</template>
