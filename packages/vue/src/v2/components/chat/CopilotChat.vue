<script setup lang="ts">
import {
  AGUIConnectNotImplementedError,
  AbstractAgent,
  HttpAgent,
} from "@ag-ui/client";
import {
  DEFAULT_AGENT_ID,
  randomUUID,
  TranscriptionErrorCode,
} from "@copilotkit/shared";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowRef,
  useAttrs,
  useSlots,
  watch,
} from "vue";
import type { Suggestion } from "@copilotkit/core";
import CopilotChatConfigurationProvider from "../../providers/CopilotChatConfigurationProvider.vue";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { useCopilotKit } from "../../providers/useCopilotKit";
import { useLicenseContext } from "../../providers/useLicenseContext";
import InlineFeatureWarning from "../InlineFeatureWarning.vue";
import { useAgent } from "../../hooks/use-agent";
import { useSuggestions } from "../../hooks/use-suggestions";
import { useAttachments } from "../../hooks/use-attachments";
import { useShallowStableRef } from "../../lib/shallow-stable";
import {
  transcribeAudio,
  TranscriptionError,
} from "../../lib/transcription-client";
import CopilotChatView from "./CopilotChatView.vue";
import {
  LastUserMessageKey,
  type LastUserMessageState,
} from "./last-user-message-context";
import type { Message } from "@ag-ui/core";
import type { InputContent } from "@copilotkit/shared";
import type {
  CopilotChatInputSlotProps,
  CopilotChatProps,
  CopilotChatInterruptSlotProps,
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
  "message-view"?: (props: {
    messages: Message[];
    isRunning: boolean;
  }) => unknown;
  interrupt?: (props: CopilotChatInterruptSlotProps) => unknown;
  input?: (props: CopilotChatInputSlotProps) => unknown;
  "suggestion-view"?: (props: CopilotChatSuggestionViewSlotProps) => unknown;
  "welcome-screen"?: (props: CopilotChatWelcomeScreenSlotProps) => unknown;
  "welcome-message"?: () => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

const attrs = useAttrs();
const componentSlots = useSlots();
const existingConfig = useCopilotChatConfiguration();
const { copilotkit } = useCopilotKit();
const forwardedChatViewSlotNames = computed(() =>
  Object.keys(componentSlots).filter((slotName) => slotName !== "chat-view"),
);

const generatedThreadId = ref(randomUUID());
const transcribeMode = ref<"input" | "transcribe" | "processing">("input");
const inputValue = ref(props.inputValue ?? "");
const transcriptionError = ref<string | null>(null);
const isTranscribing = ref(false);
const isMounted = ref(false);
const isUnmounting = ref(false);

type ActiveConnectCycle = {
  core: object;
  agent: AbstractAgent;
  threadId: string;
  abortController: AbortController;
  detached: boolean;
};

const activeConnectCycle = shallowRef<ActiveConnectCycle | null>(null);

const resolvedAgentId = computed(
  () => props.agentId ?? existingConfig.value?.agentId ?? DEFAULT_AGENT_ID,
);
// "Provided" — supplied by either the caller's prop or a wrapping
// CopilotChatConfigurationProvider. Distinct from `resolvedThreadId`, which
// falls back to a locally minted UUID when neither source is set. We only
// gate `/connect` on a provided id; the local UUID has never been seen by
// the backend and would always 404.
const providedThreadId = computed(
  () => props.threadId ?? existingConfig.value?.threadId,
);
const resolvedThreadId = computed(
  () => providedThreadId.value ?? generatedThreadId.value,
);
// "Explicit" means the caller actually picked this thread — via the
// `threadId` prop on CopilotChat or a wrapping provider that flagged its
// threadId as caller-chosen. An auto-minted UUID leaking down through a
// CopilotChatConfigurationProvider does NOT count.
const hasExplicitThreadId = computed(
  () => !!props.threadId || !!existingConfig.value?.hasExplicitThreadId,
);
const lastConnectedThreadId = ref<string | null>(null);
const isConnecting = computed(
  () =>
    hasExplicitThreadId.value &&
    lastConnectedThreadId.value !== resolvedThreadId.value,
);
const stableLabels = useShallowStableRef(computed(() => props.labels));
const resolvedLabels = computed(() => stableLabels.value);

const { agent } = useAgent({
  agentId: resolvedAgentId,
  threadId: resolvedThreadId,
  throttleMs: computed(() => props.throttleMs),
});
const { suggestions: autoSuggestions } = useSuggestions({
  agentId: resolvedAgentId,
});

const license = useLicenseContext();
const isChatLicensed = computed(() => license.value.checkFeature("chat"));

watch(
  isChatLicensed,
  (licensed) => {
    if (!licensed) {
      console.warn(
        '[CopilotKit] Warning: "chat" feature is not licensed. Visit copilotkit.ai/pricing',
      );
    }
  },
  { immediate: true },
);

const isTranscriptionEnabled = computed(
  () => copilotkit.value.audioFileTranscriptionEnabled,
);
const isMediaRecorderSupported = computed(
  () => typeof window !== "undefined" && typeof MediaRecorder !== "undefined",
);
const showTranscription = computed(
  () => isTranscriptionEnabled.value && isMediaRecorderSupported.value,
);
const {
  attachments,
  enabled: attachmentsEnabled,
  dragOver,
  fileInputRef,
  containerRef: attachmentContainerRef,
  handleFileUpload,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  removeAttachment,
  consumeAttachments,
} = useAttachments({
  config: computed(() => props.attachments),
});
const effectiveMode = computed<"input" | "transcribe" | "processing">(() =>
  isTranscribing.value ? "processing" : transcribeMode.value,
);
const runLifecycleTick = ref(0);
const messages = computed(() => [...(agent.value?.messages ?? [])]);
const isRunning = computed(() => {
  void runLifecycleTick.value;
  return agent.value?.isRunning ?? false;
});
const shouldAllowStop = computed(
  () => isRunning.value && messages.value.length > 0,
);

// Track the latest user message id so descendants (notably `usePinToSend`
// inside `CopilotChatView`) can anchor to the most recent user turn.
// Mirrors React `CopilotChat.tsx` `lastUserMessageId` + `sendNonce` state.
const lastUserMessageId = computed<string | null>(() => {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const message = messages.value[i];
    if (message?.role === "user") return message.id;
  }
  return null;
});
const sendNonce = ref(0);
// Seed with the current value so restoring a thread with existing messages
// does not count as a new send. Only later id transitions bump.
let prevLastUserMessageId: string | null = lastUserMessageId.value;
watch(lastUserMessageId, (next) => {
  if (next && next !== prevLastUserMessageId) {
    sendNonce.value += 1;
    prevLastUserMessageId = next;
  }
});
const lastUserMessageState = computed<LastUserMessageState>(() => ({
  id: lastUserMessageId.value,
  sendNonce: sendNonce.value,
}));
provide(LastUserMessageKey, lastUserMessageState);

watch(
  () => agent.value,
  (currentAgent, _previous, onCleanup) => {
    if (!currentAgent) return;
    const sub = currentAgent.subscribe({
      onRunStartedEvent: () => {
        runLifecycleTick.value += 1;
      },
      onRunFinishedEvent: () => {
        runLifecycleTick.value += 1;
      },
      onRunErrorEvent: () => {
        runLifecycleTick.value += 1;
      },
    });
    onCleanup(() => sub.unsubscribe());
  },
  { immediate: true },
);

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
  [() => copilotkit.value, resolvedAgentId, () => props.onError],
  ([core, agentId, onError], _old, onCleanup) => {
    if (!onError) {
      return;
    }

    const subscription = core.subscribe({
      onError: (event) => {
        if (event.context?.agentId === agentId || !event.context?.agentId) {
          void onError({
            error: event.error,
            code: event.code,
            context: event.context,
          });
        }
      },
    });

    onCleanup(() => subscription.unsubscribe());
  },
  { immediate: true },
);

watch(
  [
    isMounted,
    () => copilotkit.value,
    () => agent.value,
    resolvedThreadId,
    hasExplicitThreadId,
  ],
  ([mounted, core, currentAgent, threadId, isExplicit], _old, onCleanup) => {
    if (!mounted) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    if (!currentAgent) {
      return;
    }
    // When the caller hasn't picked a specific thread, resolvedThreadId is
    // a UUID minted locally. The backend has never seen it, so /connect
    // would always 404 — skip the call. A real thread is only created
    // once the user runs the agent for the first time.
    if (!isExplicit) {
      return;
    }

    const abstractAgentPrototype = AbstractAgent.prototype as unknown as {
      connect?: unknown;
      connectAgent?: unknown;
    };
    const inspectableAgent = currentAgent as unknown as {
      connect?: unknown;
      connectAgent?: unknown;
    };
    const hasCustomConnect =
      inspectableAgent.connect !== abstractAgentPrototype.connect;
    const hasCustomConnectAgent =
      inspectableAgent.connectAgent !== abstractAgentPrototype.connectAgent;
    if (!hasCustomConnect && !hasCustomConnectAgent) {
      // No custom connect to wait for — mark as connected so the welcome
      // suppression / suggestion gating release immediately.
      lastConnectedThreadId.value = threadId;
      return;
    }

    const existingCycle = activeConnectCycle.value;
    const hasSameDeps =
      existingCycle &&
      existingCycle.core === (core as object) &&
      existingCycle.agent === currentAgent &&
      existingCycle.threadId === threadId;

    let cycle: ActiveConnectCycle;
    if (hasSameDeps && existingCycle) {
      cycle = existingCycle;
    } else {
      const connectAbortController = new AbortController();
      if (currentAgent instanceof HttpAgent) {
        currentAgent.abortController = connectAbortController;
      }

      cycle = {
        core: core as object,
        agent: currentAgent,
        threadId,
        abortController: connectAbortController,
        detached: false,
      };
      activeConnectCycle.value = cycle;

      void core
        .connectAgent({ agent: currentAgent })
        .catch((error: unknown) => {
          if (cycle.detached) {
            return;
          }
          if (error instanceof AGUIConnectNotImplementedError) {
            return;
          }
          console.error("CopilotChat: connectAgent failed", error);
        })
        .finally(() => {
          // Whether the connect succeeded or failed, we're no longer in
          // the transitional "connecting" state for this thread — release
          // the welcome / suggestion gating so the view can settle.
          //
          // Defer one animation frame so any trailing reactive commits
          // from the bootstrap replay (final assistant message content)
          // paint before isConnecting flips off. Without this, suggestions
          // can briefly render against an incompletely-laid-out message
          // tree and visibly snap once the last text chunk lands.
          if (cycle.detached) {
            return;
          }
          const raf =
            typeof requestAnimationFrame === "function"
              ? requestAnimationFrame
              : (cb: () => void) => setTimeout(cb, 16);
          raf(() => {
            if (cycle.detached) return;
            lastConnectedThreadId.value = cycle.threadId;
          });
        });
    }

    onCleanup(() => {
      const activeCycle = activeConnectCycle.value;
      if (!activeCycle || activeCycle !== cycle) {
        return;
      }

      const shouldDetach =
        isUnmounting.value ||
        copilotkit.value !== activeCycle.core ||
        agent.value !== activeCycle.agent ||
        resolvedThreadId.value !== activeCycle.threadId;
      if (!shouldDetach) {
        return;
      }

      activeCycle.detached = true;
      activeCycle.abortController.abort();
      void activeCycle.agent.detachActiveRun?.();
      activeConnectCycle.value = null;
    });
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  isUnmounting.value = true;
});

onMounted(() => {
  isMounted.value = true;
});

watch(transcriptionError, (next, _old, onCleanup) => {
  if (!next) {
    return;
  }
  const timer = setTimeout(() => {
    transcriptionError.value = null;
  }, 5000);
  onCleanup(() => clearTimeout(timer));
});

async function runCurrentAgent() {
  const currentAgent = agent.value;
  if (!currentAgent) {
    return;
  }

  try {
    const activeCycle = activeConnectCycle.value;
    if (
      activeCycle &&
      activeCycle.agent === currentAgent &&
      activeCycle.threadId === resolvedThreadId.value
    ) {
      activeCycle.detached = true;
      activeCycle.abortController.abort();
      activeConnectCycle.value = null;
      await activeCycle.agent.detachActiveRun?.();
    }
    await copilotkit.value.runAgent({ agent: currentAgent });
  } catch (error) {
    console.error("CopilotChat: runAgent failed", error);
  }
}

async function handleSubmitMessage(value: string) {
  const hasUploading = attachments.value.some(
    (attachment) => attachment.status === "uploading",
  );
  if (hasUploading) {
    console.error("[CopilotKit] Cannot send while attachments are uploading");
    return;
  }

  emit("submit-message", value);

  if (!agent.value) {
    console.error("[CopilotKit] Cannot send message: no agent available");
    return;
  }

  const readyAttachments = consumeAttachments();
  if (readyAttachments.length > 0) {
    const contentParts: InputContent[] = [];
    if (value.trim()) {
      contentParts.push({ type: "text", text: value });
    }
    for (const attachment of readyAttachments) {
      contentParts.push({
        type: attachment.type,
        source: attachment.source,
        metadata: {
          ...(attachment.filename ? { filename: attachment.filename } : {}),
          ...attachment.metadata,
        },
      } as InputContent);
    }
    agent.value.addMessage({
      id: randomUUID(),
      role: "user",
      content: contentParts,
    });
  } else {
    agent.value.addMessage({
      id: randomUUID(),
      role: "user",
      content: value,
    });
  }

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
  if (!attachmentsEnabled.value) {
    return;
  }
  setTimeout(() => {
    fileInputRef.value?.click();
  }, 100);
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
    inputValue.value = trimmedPrevious
      ? `${trimmedPrevious} ${result.text}`
      : result.text;
  } catch (error) {
    console.error("CopilotChat: Transcription failed", error);
    if (error instanceof TranscriptionError) {
      const { code, retryable, message } = error.info;
      switch (code) {
        case TranscriptionErrorCode.RATE_LIMITED:
          transcriptionError.value = "Too many requests. Please wait a moment.";
          break;
        case TranscriptionErrorCode.AUTH_FAILED:
          transcriptionError.value =
            "Authentication error. Please check your configuration.";
          break;
        case TranscriptionErrorCode.AUDIO_TOO_LONG:
          transcriptionError.value =
            "Recording is too long. Please try a shorter recording.";
          break;
        case TranscriptionErrorCode.AUDIO_TOO_SHORT:
          transcriptionError.value =
            "Recording is too short. Please try again.";
          break;
        case TranscriptionErrorCode.INVALID_AUDIO_FORMAT:
          transcriptionError.value = "Audio format not supported.";
          break;
        case TranscriptionErrorCode.SERVICE_NOT_CONFIGURED:
          transcriptionError.value = "Transcription service is not available.";
          break;
        case TranscriptionErrorCode.NETWORK_ERROR:
          transcriptionError.value =
            "Network error. Please check your connection.";
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
  attachments: attachments.value,
  dragOver: dragOver.value,
  inputValue: inputValue.value,
  inputMode: effectiveMode.value,
  inputToolsMenu: props.inputToolsMenu,
  isConnecting: isConnecting.value,
  hasExplicitThreadId: hasExplicitThreadId.value,
  onSubmitMessage: handleSubmitMessage,
  onStop: shouldAllowStop.value ? handleStop : undefined,
  onInputChange: handleInputChange,
  onSelectSuggestion: handleSelectSuggestion,
  onRemoveAttachment: removeAttachment,
  onAddFile: attachmentsEnabled.value ? handleAddFile : undefined,
  onDragOver: attachmentsEnabled.value ? handleDragOver : undefined,
  onDragLeave: attachmentsEnabled.value ? handleDragLeave : undefined,
  onDrop: attachmentsEnabled.value ? handleDrop : undefined,
  onStartTranscribe: showTranscription.value
    ? handleStartTranscribe
    : undefined,
  onCancelTranscribe: showTranscription.value
    ? handleCancelTranscribe
    : undefined,
  onFinishTranscribe: showTranscription.value
    ? handleFinishTranscribe
    : undefined,
  onFinishTranscribeWithAudio: showTranscription.value
    ? handleFinishTranscribeWithAudio
    : undefined,
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
  if (attachmentsEnabled.value) {
    listeners.onAddFile = handleAddFile;
    listeners.attachments = attachments.value;
    listeners.onRemoveAttachment = removeAttachment;
    listeners.dragOver = dragOver.value;
    listeners.onDragOver = handleDragOver;
    listeners.onDragLeave = handleDragLeave;
    listeners.onDrop = handleDrop;
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
    :has-explicit-thread-id="hasExplicitThreadId"
    :labels="resolvedLabels"
  >
    <div ref="attachmentContainerRef" style="display: contents">
      <input
        v-if="attachmentsEnabled"
        ref="fileInputRef"
        type="file"
        multiple
        :accept="props.attachments?.accept ?? '*/*'"
        style="display: none"
        @change="(event) => void handleFileUpload(event)"
      />
      <InlineFeatureWarning v-if="!isChatLicensed" feature-name="Chat" />
      <div
        v-if="transcriptionError"
        style="
          position: absolute;
          bottom: 100px;
          left: 50%;
          transform: translateX(-50%);
          background-color: #ef4444;
          color: white;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 14px;
          z-index: 50;
        "
      >
        {{ transcriptionError }}
      </div>

      <slot name="chat-view" v-bind="chatViewSlotProps">
        <CopilotChatView
          v-bind="defaultChatViewBindings"
          :messages="chatViewSlotProps.messages"
          :auto-scroll="chatViewSlotProps.autoScroll"
          :is-running="chatViewSlotProps.isRunning"
          :suggestions="chatViewSlotProps.suggestions"
          :suggestion-loading-indexes="
            chatViewSlotProps.suggestionLoadingIndexes
          "
          :welcome-screen="chatViewSlotProps.welcomeScreen"
          :input-value="chatViewSlotProps.inputValue"
          :input-mode="chatViewSlotProps.inputMode"
          :input-tools-menu="chatViewSlotProps.inputToolsMenu"
          :is-connecting="chatViewSlotProps.isConnecting"
          :has-explicit-thread-id="chatViewSlotProps.hasExplicitThreadId"
          :on-finish-transcribe-with-audio="
            chatViewSlotProps.onFinishTranscribeWithAudio
          "
        >
          <template
            v-for="slotName in forwardedChatViewSlotNames"
            :key="slotName"
            #[slotName]="slotProps"
          >
            <slot :name="slotName" v-bind="slotProps" />
          </template>
        </CopilotChatView>
      </slot>
    </div>
  </CopilotChatConfigurationProvider>
</template>
