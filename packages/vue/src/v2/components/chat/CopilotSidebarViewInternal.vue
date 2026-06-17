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
  CopilotChatFeatherSlotProps,
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

const DEFAULT_SIDEBAR_WIDTH = 480;
const SIDEBAR_TRANSITION_MS = 260;

const props = withDefaults(
  defineProps<Omit<CopilotSidebarViewProps, "defaultOpen">>(),
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
    width: undefined,
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
  input?: (props: CopilotSidebarWelcomeScreenInputSlotProps) => unknown;
  "suggestion-view"?: (
    props: CopilotSidebarWelcomeScreenSuggestionViewSlotProps,
  ) => unknown;
  "welcome-screen"?: (props: CopilotChatWelcomeScreenSlotProps) => unknown;
  "welcome-message"?: () => unknown;
}>();

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
const instance = getCurrentInstance();
const vnodeProps = computed(
  () => (instance?.vnode.props ?? {}) as Record<string, unknown>,
);

const sidebarRef = ref<HTMLElement | null>(null);
const measuredSidebarWidth = ref<number | string>(
  props.width ?? DEFAULT_SIDEBAR_WIDTH,
);
let resizeObserver: ResizeObserver | null = null;

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
  "cpk:fixed cpk:right-0 cpk:top-0 cpk:z-[1200] cpk:flex cpk:h-[100vh] cpk:h-[100dvh] cpk:max-h-screen cpk:w-full",
  "cpk:border-l cpk:border-border cpk:bg-background cpk:text-foreground cpk:shadow-xl",
  "cpk:transition-transform cpk:duration-300 cpk:ease-out",
  isSidebarOpen.value
    ? "cpk:translate-x-0"
    : "cpk:translate-x-full cpk:pointer-events-none",
  attrs.class,
]);
const asideAttrs = computed(() => {
  const { class: _className, ...rest } = attrs;
  return rest;
});
const hasStopAction = computed(() => hasListener("onStop"));
const asideStyle = computed(
  () =>
    ({
      "--sidebar-width": widthToCss(resolvedSidebarWidth.value),
      paddingTop: "env(safe-area-inset-top)",
      paddingBottom: "env(safe-area-inset-bottom)",
    }) as Record<string, string>,
);
const bodyMarginStyle = computed(
  () => `
@media (min-width: 768px) {
  body {
    margin-inline-end: ${widthToMargin(resolvedSidebarWidth.value)};
    transition: margin-inline-end ${SIDEBAR_TRANSITION_MS}ms ease;
  }
}
`,
);

function hasListener(listenerName: string) {
  const listener = vnodeProps.value[listenerName];
  if (Array.isArray(listener)) {
    return listener.length > 0;
  }
  return !!listener;
}

function widthToCss(width: number | string): string {
  return typeof width === "number" ? `${width}px` : width;
}

function widthToMargin(width: number | string): string {
  return typeof width === "number" ? `${width}px` : width;
}

function updateMeasuredWidth() {
  if (props.width !== undefined || !sidebarRef.value) {
    return;
  }

  const nextWidth = sidebarRef.value.getBoundingClientRect().width;
  if (nextWidth > 0) {
    measuredSidebarWidth.value = nextWidth;
  }
}

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

  if (hasStopAction.value) {
    listeners.onStop = handleStop;
  }
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

watch(
  () => props.width,
  (nextWidth) => {
    if (nextWidth !== undefined) {
      measuredSidebarWidth.value = nextWidth;
      return;
    }
    updateMeasuredWidth();
  },
);

onMounted(async () => {
  await nextTick();
  updateMeasuredWidth();

  if (
    props.width !== undefined ||
    !sidebarRef.value ||
    typeof ResizeObserver === "undefined"
  ) {
    return;
  }

  resizeObserver = new ResizeObserver(() => {
    updateMeasuredWidth();
  });
  resizeObserver.observe(sidebarRef.value);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <component :is="'style'" v-if="isSidebarOpen">
    {{ bodyMarginStyle }}
  </component>

  <slot
    name="toggle-button"
    :is-open="isSidebarOpen"
    :toggle="toggleSidebar"
    :open="openSidebar"
    :close="closeSidebar"
  >
    <CopilotChatToggleButton />
  </slot>

  <aside
    ref="sidebarRef"
    data-copilotkit
    data-copilot-sidebar
    :class="asideClass"
    :style="asideStyle"
    aria-label="Copilot chat sidebar"
    :aria-hidden="!isSidebarOpen"
    role="complementary"
    v-bind="asideAttrs"
  >
    <div
      class="cpk:flex cpk:h-full cpk:w-full cpk:flex-col cpk:overflow-hidden"
    >
      <slot
        name="header"
        :title="headerTitle"
        :on-close="closeSidebar"
        :is-open="isSidebarOpen"
      >
        <CopilotModalHeader :title="headerTitle" />
      </slot>

      <div class="cpk:flex-1 cpk:overflow-hidden" data-sidebar-chat>
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
          v-bind="chatViewEventProps"
        >
          <template v-if="$slots['message-view']" #message-view="slotProps">
            <slot name="message-view" v-bind="slotProps" />
          </template>

          <template v-if="$slots['scroll-view']" #scroll-view="slotProps">
            <slot name="scroll-view" v-bind="slotProps" />
          </template>

          <template v-if="$slots.feather" #feather>
            <slot name="feather" />
          </template>

          <template
            v-if="$slots['scroll-to-bottom-button']"
            #scroll-to-bottom-button="slotProps"
          >
            <slot name="scroll-to-bottom-button" v-bind="slotProps" />
          </template>

          <template v-if="$slots.input" #input="slotProps">
            <slot name="input" v-bind="slotProps" />
          </template>

          <template
            v-if="$slots['suggestion-view']"
            #suggestion-view="slotProps"
          >
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
  </aside>
</template>
