<script setup lang="ts">
import { computed, useAttrs } from "vue";
import CopilotChatConfigurationProvider from "../../providers/CopilotChatConfigurationProvider.vue";
import { forwardedSlotNames } from "./forwarded-slots";
import CopilotSidebarViewInternal from "./CopilotSidebarViewInternal.vue";
import type {
  CopilotChatFeatherSlotProps,
  CopilotChatInterruptSlotProps,
  CopilotChatWelcomeScreenSlotProps,
  CopilotChatMessageViewSlotProps,
  CopilotChatScrollToBottomButtonSlotProps,
  CopilotChatScrollViewSlotProps,
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

const internalProps = computed(() => {
  const { defaultOpen: _defaultOpen, ...rest } = props;
  return rest;
});
const internalBindings = computed(() => ({
  ...attrs,
  ...internalProps.value,
  ...forwardedEventListeners.value,
}));

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
</script>

<template>
  <CopilotChatConfigurationProvider :is-modal-default-open="defaultOpen">
    <CopilotSidebarViewInternal v-bind="internalBindings">
      <template
        v-for="slotName in forwardedSlotNames($slots)"
        :key="slotName"
        #[slotName]="slotProps"
      >
        <slot :name="slotName" v-bind="slotProps" />
      </template>
    </CopilotSidebarViewInternal>
  </CopilotChatConfigurationProvider>
</template>
