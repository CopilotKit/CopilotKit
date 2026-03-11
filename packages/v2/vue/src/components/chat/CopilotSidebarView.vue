<script setup lang="ts">
import { computed, getCurrentInstance, useAttrs } from "vue";
import CopilotChatConfigurationProvider from "../../providers/CopilotChatConfigurationProvider.vue";
import CopilotSidebarViewInternal from "./CopilotSidebarViewInternal.vue";
import type {
  CopilotChatWelcomeScreenSlotProps,
  CopilotChatMessageViewSlotProps,
  CopilotSidebarWelcomeScreenInputSlotProps,
  CopilotSidebarWelcomeScreenSuggestionViewSlotProps,
  CopilotSidebarViewProps,
} from "./types";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<CopilotSidebarViewProps>(), {
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
  defaultOpen: true,
  onFinishTranscribeWithAudio: undefined,
});

defineSlots<{
  header?: (props: {
    title: string;
    onClose: () => void;
    isOpen: boolean;
  }) => unknown;
  "toggle-button"?: (props: {
    isOpen: boolean;
    toggle: () => void;
    open: () => void;
    close: () => void;
  }) => unknown;
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
const instance = getCurrentInstance();
const vnodeProps = computed(() => (instance?.vnode.props ?? {}) as Record<string, unknown>);

const internalProps = computed(() => {
  const { defaultOpen: _defaultOpen, ...rest } = props;
  return rest;
});
const internalBindings = computed(() => ({
  ...attrs,
  ...internalProps.value,
  ...forwardedEventListeners.value,
}));

function hasListener(listenerName: string) {
  const listener = vnodeProps.value[listenerName];
  if (Array.isArray(listener)) {
    return listener.length > 0;
  }
  return !!listener;
}

const forwardedEventListeners = computed(() => {
  const listeners: Record<string, unknown> = {
    onSubmitMessage: (value: string) => emit("submit-message", value),
    onStop: () => emit("stop"),
    onInputChange: (value: string) => emit("input-change", value),
    onSelectSuggestion: (suggestion: (typeof props.suggestions)[number], index: number) =>
      emit("select-suggestion", suggestion, index),
  };

  if (hasListener("onAddFile")) {
    listeners.onAddFile = () => emit("add-file");
  }
  if (hasListener("onStartTranscribe")) {
    listeners.onStartTranscribe = () => emit("start-transcribe");
  }
  if (hasListener("onCancelTranscribe")) {
    listeners.onCancelTranscribe = () => emit("cancel-transcribe");
  }
  if (hasListener("onFinishTranscribe")) {
    listeners.onFinishTranscribe = () => emit("finish-transcribe");
  }

  return listeners;
});
</script>

<template>
  <CopilotChatConfigurationProvider :is-modal-default-open="defaultOpen">
    <CopilotSidebarViewInternal v-bind="internalBindings">
      <template v-if="$slots.header" #header="slotProps">
        <slot name="header" v-bind="slotProps" />
      </template>

      <template v-if="$slots['toggle-button']" #toggle-button="slotProps">
        <slot name="toggle-button" v-bind="slotProps" />
      </template>

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
    </CopilotSidebarViewInternal>
  </CopilotChatConfigurationProvider>
</template>
