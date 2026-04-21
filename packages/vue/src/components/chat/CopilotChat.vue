<script setup lang="ts">
import {
  AGUIConnectNotImplementedError,
  AbstractAgent,
  HttpAgent,
} from "@ag-ui/client";
import {
  DEFAULT_AGENT_ID,
  getModalityFromMimeType,
  matchesAcceptFilter,
  exceedsMaxSize,
  formatFileSize,
  readFileAsBase64,
  generateVideoThumbnail,
  randomUUID,
  TranscriptionErrorCode,
} from "@copilotkit/shared";
import {
  computed,
  onBeforeUnmount,
  onMounted,
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
import { useAgent } from "../../hooks/use-agent";
import { useSuggestions } from "../../hooks/use-suggestions";
import {
  transcribeAudio,
  TranscriptionError,
} from "../../lib/transcription-client";
import CopilotChatView from "./CopilotChatView.vue";
import type { Message } from "@ag-ui/core";
import type {
  Attachment,
  AttachmentUploadResult,
  InputContent,
} from "@copilotkit/shared";
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
const attachments = ref<Attachment[]>([]);
const dragOver = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const attachmentContainerRef = ref<HTMLElement | null>(null);

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
const resolvedThreadId = computed(
  () =>
    props.threadId ?? existingConfig.value?.threadId ?? generatedThreadId.value,
);
const resolvedLabels = computed(() => props.labels);

const { agent } = useAgent({
  agentId: resolvedAgentId,
  threadId: resolvedThreadId,
  throttleMs: computed(() => props.throttleMs),
});
const { suggestions: autoSuggestions } = useSuggestions({
  agentId: resolvedAgentId,
});

const isTranscriptionEnabled = computed(
  () => copilotkit.value.audioFileTranscriptionEnabled,
);
const isMediaRecorderSupported = computed(
  () => typeof window !== "undefined" && typeof MediaRecorder !== "undefined",
);
const showTranscription = computed(
  () => isTranscriptionEnabled.value && isMediaRecorderSupported.value,
);
const attachmentsEnabled = computed(() => props.attachments?.enabled ?? false);
const effectiveMode = computed<"input" | "transcribe" | "processing">(() =>
  isTranscribing.value ? "processing" : transcribeMode.value,
);
const runLifecycleTick = ref(0);
const messages = computed(() => [...(agent.value?.messages ?? [])]);
const isRunning = computed(() => {
  runLifecycleTick.value += 0;
  return agent.value?.isRunning ?? false;
});
const shouldAllowStop = computed(
  () => isRunning.value && messages.value.length > 0,
);

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

async function processFiles(files: File[]) {
  const config = props.attachments;
  if (!config?.enabled) {
    return;
  }

  const accept = config.accept ?? "*/*";
  const maxSize = config.maxSize ?? 20 * 1024 * 1024;

  const rejectedFiles = files.filter(
    (file) => !matchesAcceptFilter(file, accept),
  );
  for (const file of rejectedFiles) {
    config.onUploadFailed?.({
      reason: "invalid-type",
      file,
      message: `File "${file.name}" is not accepted. Supported types: ${accept}`,
    });
  }

  const validFiles = files.filter((file) => matchesAcceptFilter(file, accept));
  for (const file of validFiles) {
    if (exceedsMaxSize(file, maxSize)) {
      config.onUploadFailed?.({
        reason: "file-too-large",
        file,
        message: `File "${file.name}" exceeds the maximum size of ${formatFileSize(maxSize)}`,
      });
      continue;
    }

    const modality = getModalityFromMimeType(file.type);
    const placeholderId = randomUUID();
    attachments.value = [
      ...attachments.value,
      {
        id: placeholderId,
        type: modality,
        source: { type: "data", value: "", mimeType: file.type },
        filename: file.name,
        size: file.size,
        status: "uploading",
      },
    ];

    try {
      let source: Attachment["source"];
      let uploadMetadata: Record<string, unknown> | undefined;
      if (config.onUpload) {
        const uploadResult: AttachmentUploadResult =
          await config.onUpload(file);
        const { metadata, ...uploadSource } = uploadResult;
        source = uploadSource;
        uploadMetadata = metadata;
      } else {
        const base64 = await readFileAsBase64(file);
        source = { type: "data", value: base64, mimeType: file.type };
      }

      let thumbnail: string | undefined;
      if (modality === "video") {
        thumbnail = await generateVideoThumbnail(file);
      }

      attachments.value = attachments.value.map((attachment) =>
        attachment.id === placeholderId
          ? {
              ...attachment,
              source,
              status: "ready",
              thumbnail,
              metadata: uploadMetadata,
            }
          : attachment,
      );
    } catch (error) {
      attachments.value = attachments.value.filter(
        (attachment) => attachment.id !== placeholderId,
      );
      console.error(`[CopilotKit] Failed to upload "${file.name}":`, error);
      config.onUploadFailed?.({
        reason: "upload-failed",
        file,
        message:
          error instanceof Error
            ? error.message
            : `Failed to upload "${file.name}"`,
      });
    }
  }
}

async function handleFileUpload(event: Event) {
  const target = event.target as HTMLInputElement | null;
  if (!target?.files?.length) {
    return;
  }
  await processFiles(Array.from(target.files));
}

function handleDragOver(event: DragEvent) {
  if (!attachmentsEnabled.value) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  dragOver.value = true;
}

function handleDragLeave(event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  dragOver.value = false;
}

async function handleDrop(event: DragEvent) {
  event.preventDefault();
  event.stopPropagation();
  dragOver.value = false;
  if (!attachmentsEnabled.value) {
    return;
  }
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length > 0) {
    await processFiles(files);
  }
}

function removeAttachment(id: string) {
  attachments.value = attachments.value.filter(
    (attachment) => attachment.id !== id,
  );
}

function consumeAttachments() {
  const ready = attachments.value.filter(
    (attachment) => attachment.status === "ready",
  );
  if (ready.length === 0) {
    return ready;
  }
  attachments.value = attachments.value.filter(
    (attachment) => attachment.status !== "ready",
  );
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
  }
  return ready;
}

async function handlePaste(event: ClipboardEvent) {
  if (!attachmentsEnabled.value) {
    return;
  }

  const target = event.target as HTMLElement | null;
  if (!target || !attachmentContainerRef.value?.contains(target)) {
    return;
  }

  const accept = props.attachments?.accept ?? "*/*";
  const items = Array.from(event.clipboardData?.items ?? []);
  const fileItems = items.filter((item) => {
    if (item.kind !== "file") {
      return false;
    }
    const file = item.getAsFile();
    return file !== null && matchesAcceptFilter(file, accept);
  });
  if (fileItems.length === 0) {
    return;
  }

  event.preventDefault();
  const files = fileItems
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  await processFiles(files);
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
  [isMounted, () => copilotkit.value, () => agent.value, resolvedThreadId],
  ([mounted, core, currentAgent, threadId], _old, onCleanup) => {
    if (!mounted) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    if (!currentAgent) {
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
  if (typeof document !== "undefined") {
    document.removeEventListener("paste", handlePaste);
  }
});

onMounted(() => {
  isMounted.value = true;
  if (typeof document !== "undefined") {
    document.addEventListener("paste", handlePaste);
  }
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
    agent.value?.addMessage({
      id: randomUUID(),
      role: "user",
      content: contentParts,
    });
  } else {
    agent.value?.addMessage({
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
          :on-finish-transcribe-with-audio="
            chatViewSlotProps.onFinishTranscribeWithAudio
          "
          v-bind="defaultChatViewBindings"
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
