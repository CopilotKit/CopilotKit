<script setup lang="ts">
import { AGUIConnectNotImplementedError } from "@ag-ui/client";
import { DEFAULT_AGENT_ID, randomUUID, TranscriptionErrorCode } from "@copilotkitnext/shared";
import { computed, getCurrentInstance, ref, shallowRef, useAttrs, watch } from "vue";
import type { Suggestion } from "@copilotkitnext/core";
import CopilotChatConfigurationProvider from "../../providers/CopilotChatConfigurationProvider.vue";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useAgent } from "../../hooks/use-agent";
import { useSuggestions } from "../../hooks/use-suggestions";
import { transcribeAudio, TranscriptionError } from "../../lib/transcription-client";
import CopilotChatView from "./CopilotChatView.vue";
import type {
  CopilotChatInputSlotProps,
  CopilotChatProps,
  CopilotChatSuggestionViewSlotProps,
  CopilotChatViewOverrideSlotProps,
  CopilotChatWelcomeScreenSlotProps,
} from "./types";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<CopilotChatProps>(), {
  autoScroll: true,
  welcomeScreen: true,
  inputValue: undefined,
  inputMode: "input",
  inputToolsMenu: () => [],
  onFinishTranscribeWithAudio: undefined,
});

defineSlots<{
  "chat-view"?: (props: CopilotChatViewOverrideSlotProps) => unknown;
  "message-view"?: (props: { messages: import("@ag-ui/core").Message[]; isRunning: boolean }) => unknown;
  input?: (props: CopilotChatInputSlotProps) => unknown;
  "suggestion-view"?: (props: CopilotChatSuggestionViewSlotProps) => unknown;
  "welcome-screen"?: (props: CopilotChatWelcomeScreenSlotProps) => unknown;
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

const attrs = useAttrs();
const existingConfig = useCopilotChatConfiguration();
const { copilotkit } = useCopilotKit();
const instance = getCurrentInstance();
const vnodeProps = computed(() => (instance?.vnode.props ?? {}) as Record<string, unknown>);

const generatedThreadId = ref(randomUUID());
const transcribeMode = ref<"input" | "transcribe" | "processing">("input");
const inputValue = ref(props.inputValue ?? "");
const transcriptionError = ref<string | null>(null);
const isTranscribing = ref(false);
const lastConnectedAgent = shallowRef<object | null>(null);
const lastConnectedCore = shallowRef<object | null>(null);
const lastConnectedThreadId = ref<string | undefined>(undefined);

const resolvedAgentId = computed(() => props.agentId ?? existingConfig.value?.agentId ?? DEFAULT_AGENT_ID);
const resolvedThreadId = computed(
  () => props.threadId ?? existingConfig.value?.threadId ?? generatedThreadId.value,
);
const resolvedLabels = computed(() => props.labels);

const { agent } = useAgent({ agentId: resolvedAgentId });
const {
  suggestions: autoSuggestions,
} = useSuggestions({ agentId: resolvedAgentId });

const isTranscriptionEnabled = computed(() => copilotkit.value.audioFileTranscriptionEnabled);
const isMediaRecorderSupported = computed(
  () => typeof window !== "undefined" && typeof MediaRecorder !== "undefined",
);
const showTranscription = computed(
  () => isTranscriptionEnabled.value && isMediaRecorderSupported.value,
);
const effectiveMode = computed<"input" | "transcribe" | "processing">(() =>
  isTranscribing.value ? "processing" : transcribeMode.value,
);
const messages = computed(() => [...(agent.value?.messages ?? [])]);
const isRunning = computed(() => agent.value?.isRunning ?? false);
const shouldAllowStop = computed(() => isRunning.value && messages.value.length > 0);

function hasListener(listenerName: string) {
  const listener = vnodeProps.value[listenerName];
  if (Array.isArray(listener)) {
    return listener.length > 0;
  }
  return !!listener;
}

watch(
  () => props.inputValue,
  (next) => {
    if (next !== undefined) {
      inputValue.value = next;
    }
  },
);

watch(
  [() => props.threadId, () => existingConfig.value?.threadId],
  ([threadId, inheritedThreadId], previousValues) => {
    if (threadId || inheritedThreadId) {
      return;
    }

    if (previousValues && (previousValues[0] || previousValues[1])) {
      generatedThreadId.value = randomUUID();
    }
  },
);

watch(
  [agent, resolvedThreadId, copilotkit],
  ([currentAgent, threadId, core]) => {
    if (typeof window === "undefined") {
      return;
    }
    if (!currentAgent) {
      return;
    }

    if (currentAgent.threadId !== threadId) {
      currentAgent.threadId = threadId;
    }
    if (!core.runtimeUrl) {
      return;
    }
    if (
      lastConnectedAgent.value === currentAgent &&
      lastConnectedCore.value === core &&
      lastConnectedThreadId.value === threadId
    ) {
      return;
    }

    lastConnectedAgent.value = currentAgent;
    lastConnectedCore.value = core;
    lastConnectedThreadId.value = threadId;

    void core.connectAgent({ agent: currentAgent }).catch((error: unknown) => {
      if (error instanceof AGUIConnectNotImplementedError) {
        return;
      }
      throw error;
    });
  },
  { immediate: true },
);

watch(
  transcriptionError,
  (next, _old, onCleanup) => {
    if (!next) {
      return;
    }
    const timer = setTimeout(() => {
      transcriptionError.value = null;
    }, 5000);
    onCleanup(() => clearTimeout(timer));
  },
);

async function runCurrentAgent() {
  const currentAgent = agent.value;
  if (!currentAgent) {
    return;
  }

  try {
    await copilotkit.value.runAgent({ agent: currentAgent });
  } catch (error) {
    console.error("CopilotChat: runAgent failed", error);
  }
}

async function handleSubmitMessage(value: string) {
  emit("submit-message", value);
  agent.value?.addMessage({
    id: randomUUID(),
    role: "user",
    content: value,
  });
  inputValue.value = "";
  await runCurrentAgent();
}

async function handleSelectSuggestion(suggestion: Suggestion, index: number) {
  emit("select-suggestion", suggestion, index);
  agent.value?.addMessage({
    id: randomUUID(),
    role: "user",
    content: suggestion.message,
  });
  await runCurrentAgent();
}

function stopCurrentRun() {
  const currentAgent = agent.value;
  if (!currentAgent) {
    return;
  }

  try {
    copilotkit.value.stopAgent({ agent: currentAgent });
  } catch (error) {
    console.error("CopilotChat: stopAgent failed", error);
    try {
      currentAgent.abortRun();
    } catch (abortError) {
      console.error("CopilotChat: abortRun fallback failed", abortError);
    }
  }
}

function handleStop() {
  emit("stop");
  if (shouldAllowStop.value) {
    stopCurrentRun();
  }
}

function handleInputChange(value: string) {
  inputValue.value = value;
  emit("input-change", value);
}

function handleAddFile() {
  emit("add-file");
}

function handleStartTranscribe() {
  transcriptionError.value = null;
  transcribeMode.value = "transcribe";
  emit("start-transcribe");
}

function handleCancelTranscribe() {
  transcriptionError.value = null;
  transcribeMode.value = "input";
  emit("cancel-transcribe");
}

function handleFinishTranscribe() {
  transcribeMode.value = "input";
  emit("finish-transcribe");
}

async function handleFinishTranscribeWithAudio(audioBlob: Blob) {
  if (props.onFinishTranscribeWithAudio) {
    await props.onFinishTranscribeWithAudio(audioBlob);
    return;
  }

  isTranscribing.value = true;
  try {
    transcriptionError.value = null;
    const result = await transcribeAudio(copilotkit.value, audioBlob);
    const trimmedPrevious = inputValue.value.trim();
    inputValue.value = trimmedPrevious ? `${trimmedPrevious} ${result.text}` : result.text;
  } catch (error) {
    console.error("CopilotChat: Transcription failed", error);
    if (error instanceof TranscriptionError) {
      const { code, retryable, message } = error.info;
      switch (code) {
        case TranscriptionErrorCode.RATE_LIMITED:
          transcriptionError.value = "Too many requests. Please wait a moment.";
          break;
        case TranscriptionErrorCode.AUTH_FAILED:
          transcriptionError.value = "Authentication error. Please check your configuration.";
          break;
        case TranscriptionErrorCode.AUDIO_TOO_LONG:
          transcriptionError.value = "Recording is too long. Please try a shorter recording.";
          break;
        case TranscriptionErrorCode.AUDIO_TOO_SHORT:
          transcriptionError.value = "Recording is too short. Please try again.";
          break;
        case TranscriptionErrorCode.INVALID_AUDIO_FORMAT:
          transcriptionError.value = "Audio format not supported.";
          break;
        case TranscriptionErrorCode.SERVICE_NOT_CONFIGURED:
          transcriptionError.value = "Transcription service is not available.";
          break;
        case TranscriptionErrorCode.NETWORK_ERROR:
          transcriptionError.value = "Network error. Please check your connection.";
          break;
        default:
          transcriptionError.value = retryable
            ? "Transcription failed. Please try again."
            : message;
      }
    } else {
      transcriptionError.value = "Transcription failed. Please try again.";
    }
  } finally {
    isTranscribing.value = false;
  }
}

const chatViewSlotProps = computed<CopilotChatViewOverrideSlotProps>(() => ({
  messages: messages.value,
  autoScroll: props.autoScroll,
  isRunning: isRunning.value,
  suggestions: autoSuggestions.value,
  suggestionLoadingIndexes: [],
  welcomeScreen: props.welcomeScreen,
  inputValue: inputValue.value,
  inputMode: effectiveMode.value,
  inputToolsMenu: props.inputToolsMenu,
  onSubmitMessage: handleSubmitMessage,
  onStop: shouldAllowStop.value ? handleStop : undefined,
  onInputChange: handleInputChange,
  onSelectSuggestion: handleSelectSuggestion,
  onAddFile: hasListener("onAddFile") ? handleAddFile : undefined,
  onStartTranscribe: showTranscription.value ? handleStartTranscribe : undefined,
  onCancelTranscribe: showTranscription.value ? handleCancelTranscribe : undefined,
  onFinishTranscribe: showTranscription.value ? handleFinishTranscribe : undefined,
  onFinishTranscribeWithAudio: showTranscription.value ? handleFinishTranscribeWithAudio : undefined,
}));

const defaultChatViewBindings = computed(() => {
  const listeners: Record<string, unknown> = {
    ...attrs,
    onSubmitMessage: handleSubmitMessage,
    onInputChange: handleInputChange,
    onSelectSuggestion: handleSelectSuggestion,
  };

  if (shouldAllowStop.value) {
    listeners.onStop = handleStop;
  }
  if (hasListener("onAddFile")) {
    listeners.onAddFile = handleAddFile;
  }
  if (showTranscription.value) {
    listeners.onStartTranscribe = handleStartTranscribe;
    listeners.onCancelTranscribe = handleCancelTranscribe;
    listeners.onFinishTranscribe = handleFinishTranscribe;
  }

  return listeners;
});
</script>

<template>
  <CopilotChatConfigurationProvider
    :agent-id="resolvedAgentId"
    :thread-id="resolvedThreadId"
    :labels="resolvedLabels"
  >
    <div
      v-if="transcriptionError"
      style="position: absolute; bottom: 100px; left: 50%; transform: translateX(-50%); background-color: #ef4444; color: white; padding: 8px 16px; border-radius: 8px; font-size: 14px; z-index: 50;"
    >
      {{ transcriptionError }}
    </div>

    <slot name="chat-view" v-bind="chatViewSlotProps">
      <CopilotChatView
        :messages="chatViewSlotProps.messages"
        :auto-scroll="chatViewSlotProps.autoScroll"
        :is-running="chatViewSlotProps.isRunning"
        :suggestions="chatViewSlotProps.suggestions"
        :suggestion-loading-indexes="chatViewSlotProps.suggestionLoadingIndexes"
        :welcome-screen="chatViewSlotProps.welcomeScreen"
        :input-value="chatViewSlotProps.inputValue"
        :input-mode="chatViewSlotProps.inputMode"
        :input-tools-menu="chatViewSlotProps.inputToolsMenu"
        :on-finish-transcribe-with-audio="chatViewSlotProps.onFinishTranscribeWithAudio"
        v-bind="defaultChatViewBindings"
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
    </slot>
  </CopilotChatConfigurationProvider>
</template>
