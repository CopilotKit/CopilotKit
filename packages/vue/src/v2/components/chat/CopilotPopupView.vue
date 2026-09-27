<script setup lang="ts">
import { computed, useAttrs } from "vue";
import CopilotChatConfigurationProvider from "../../providers/CopilotChatConfigurationProvider.vue";
import ModalThreadsDrawerScope from "../../providers/ModalThreadsDrawerScope.vue";
import { resolveModalThreadsDrawerProps } from "./modal-threads-drawer";
import CopilotPopupViewInternal from "./CopilotPopupViewInternal.vue";
import type {
  CopilotChatFeatherSlotProps,
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

const props = withDefaults(defineProps<CopilotPopupViewProps>(), {
  messages: () => [],
  autoScroll: true,
  isRunning: false,
  suggestions: () => [],
  suggestionLoadingIndexes: () => [],
  welcomeScreen: true,
  introAnimation: true,
  inputValue: undefined,
  inputMode: "input",
  inputToolsMenu: () => [],
  width: undefined,
  height: undefined,
  clickOutsideToClose: false,
  defaultOpen: true,
  threadsDrawer: false,
  onFinishTranscribeWithAudio: undefined,
});

defineSlots<{
  header?: (props: CopilotPopupViewHeaderSlotProps) => unknown;
  "toggle-button"?: (props: CopilotPopupViewToggleButtonSlotProps) => unknown;
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

// Everything but the props the view itself consumes goes to the internal view.
const internalProps = computed(() => {
  const rest: Record<string, unknown> = { ...props };
  delete rest.defaultOpen;
  delete rest.threadsDrawer;
  return rest;
});
const drawerProps = computed(() =>
  resolveModalThreadsDrawerProps(props.threadsDrawer),
);

const forwardedEventListeners = computed(() => {
  const listeners: Record<string, unknown> = {
    onSubmitMessage: (value: string) => emit("submit-message", value),
    onInputChange: (value: string) => emit("input-change", value),
    onSelectSuggestion: (
      suggestion: (typeof props.suggestions)[number],
      index: number,
    ) => emit("select-suggestion", suggestion, index),
  };

  if (props.onStop) {
    listeners.onStop = () => emit("stop");
  }
  if (props.onAddFile) {
    listeners.onAddFile = () => emit("add-file");
  }
  if (props.onStartTranscribe) {
    listeners.onStartTranscribe = () => emit("start-transcribe");
  }
  if (props.onCancelTranscribe) {
    listeners.onCancelTranscribe = () => emit("cancel-transcribe");
  }
  if (props.onFinishTranscribe) {
    listeners.onFinishTranscribe = () => emit("finish-transcribe");
  }

  return listeners;
});

const internalBindings = computed(() => ({
  ...attrs,
  ...internalProps.value,
  ...forwardedEventListeners.value,
}));
</script>

<template>
  <CopilotChatConfigurationProvider :is-modal-default-open="defaultOpen">
    <!-- The drawer's open state is local to this modal (see ModalThreadsDrawerScope). -->
    <ModalThreadsDrawerScope :enabled="drawerProps !== null">
      <CopilotPopupViewInternal
        v-bind="internalBindings"
        :drawer-props="drawerProps"
      >
        <template v-if="$slots.header" #header="slotProps">
          <slot name="header" v-bind="slotProps" />
        </template>

        <template v-if="$slots['toggle-button']" #toggle-button="slotProps">
          <slot name="toggle-button" v-bind="slotProps" />
        </template>

        <template v-if="$slots['message-view']" #message-view="slotProps">
          <slot name="message-view" v-bind="slotProps" />
        </template>

        <template v-if="$slots['scroll-view']" #scroll-view="slotProps">
          <slot name="scroll-view" v-bind="slotProps" />
        </template>

        <template v-if="$slots.feather" #feather="slotProps">
          <slot name="feather" v-bind="slotProps" />
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

        <template v-if="$slots['suggestion-view']" #suggestion-view="slotProps">
          <slot name="suggestion-view" v-bind="slotProps" />
        </template>

        <template v-if="$slots['welcome-screen']" #welcome-screen="slotProps">
          <slot name="welcome-screen" v-bind="slotProps" />
        </template>

        <template v-if="$slots['welcome-message']" #welcome-message>
          <slot name="welcome-message" />
        </template>
      </CopilotPopupViewInternal>
    </ModalThreadsDrawerScope>
  </CopilotChatConfigurationProvider>
</template>
