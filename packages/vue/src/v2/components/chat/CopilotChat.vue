<script setup lang="ts">
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
import {
  CopilotChatDefaultLabels,
  ɵChatConnection,
  ɵcreateChatSubmitter,
  ɵcreateLastUserMessageTracker,
  ɵFreshThreadId,
  ɵresolveAgentId,
  ɵresolveChatNotice,
  ɵsubscribeToAgentErrors,
} from "@copilotkit/core";
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
import CopilotChatView from "./CopilotChatView.vue";
import { LastUserMessageKey } from "./last-user-message-context";
import type { LastUserMessageState } from "./last-user-message-context";
import type { Message } from "@ag-ui/core";
import { useInspectorThreadOverride } from "../../providers/use-inspector-thread-override";
import { CopilotKitStyles } from "../../styles/CopilotKitStyles";
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
  messageFeedback: true,
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

const transcribeMode = ref<"input" | "transcribe" | "processing">("input");
const inputValue = ref(props.inputValue ?? "");
const isMounted = ref(false);

// Loads the thread this chat shows: keeps the agent on it, orders the
// teardown of the previous thread, owns the connect's abort and detach, and
// tracks connections a send must wait for.
const connection = new ɵChatConnection({
  core: {
    connectAgent: (params) => copilotkit.value.connectAgent(params),
    stopAgent: (params) => copilotkit.value.stopAgent(params),
    subscribe: (subscriber) => copilotkit.value.subscribe(subscriber),
  },
  onInspectorOverrideFailed: (requestId) => failInspectorOverride(requestId),
});
const { threads } = connection;
const connectionState = shallowRef(connection.getSnapshot());
connection.subscribe(() => {
  connectionState.value = connection.getSnapshot();
});
// The locally minted thread used while no thread is provided. A new one is
// minted each time the provided thread goes away.
const freshThreadId = new ɵFreshThreadId();

const resolvedAgentId = computed(() =>
  ɵresolveAgentId({
    agentId: props.agentId,
    chatAgentId: existingConfig.value?.agentId,
  }),
);
// "Provided" — supplied by either the caller's prop or a wrapping
// CopilotChatConfigurationProvider. Distinct from `resolvedThreadId`, which
// falls back to a locally minted UUID when neither source is set. We only
// gate `/connect` on a provided id; the local UUID has never been seen by
// the backend and would always 404.
const providedThreadId = computed(
  () => props.threadId ?? existingConfig.value?.threadId,
);
const baseThreadId = computed(() =>
  freshThreadId.resolve(providedThreadId.value),
);
// "Explicit" means the caller actually picked this thread — via the
// `threadId` prop on CopilotChat or a wrapping provider that flagged its
// threadId as caller-chosen. An auto-minted UUID leaking down through a
// CopilotChatConfigurationProvider does NOT count.
const baseHasExplicitThreadId = computed(
  () => !!props.threadId || !!existingConfig.value?.hasExplicitThreadId,
);
const { inspectorThreadId, inspectorRequestId, failInspectorOverride } =
  useInspectorThreadOverride({
    agentId: resolvedAgentId,
    baseThreadId,
  });
const resolvedThreadId = computed(
  () => inspectorThreadId.value ?? baseThreadId.value,
);
const hasExplicitThreadId = computed(
  () => inspectorThreadId.value !== null || baseHasExplicitThreadId.value,
);
// An explicit thread shows as connecting until its connect has settled.
const isConnecting = computed(() => {
  void connectionState.value;
  return connection.isConnecting({
    threadId: resolvedThreadId.value,
    explicit: hasExplicitThreadId.value,
  });
});
const stableLabels = useShallowStableRef(computed(() => props.labels));
const resolvedLabels = computed(() => stableLabels.value);
// The labels this chat shows, the same merge its configuration provider makes.
const chatLabels = computed(() => ({
  ...CopilotChatDefaultLabels,
  ...existingConfig.value?.labels,
  ...resolvedLabels.value,
}));

// `useAgent` takes no threadId: it pins one only from a surrounding chat
// configuration, and this call sits outside the provider rendered in this
// component's template, so it would never see the thread being rendered. The
// thread is assigned in the connect watcher below, mirroring React's CopilotChat.
const { agent } = useAgent({
  agentId: resolvedAgentId,
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
// Messages the chat starts with (a restored thread) do not count as a send.
const lastUserMessageTracker = ɵcreateLastUserMessageTracker(messages.value);
const lastUserMessageState = computed<LastUserMessageState>(() =>
  lastUserMessageTracker.update(messages.value),
);
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
  [() => copilotkit.value, resolvedAgentId, () => props.onError],
  ([core, agentId, onError], _old, onCleanup) => {
    if (!onError) {
      return;
    }
    onCleanup(ɵsubscribeToAgentErrors(core, agentId, onError));
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
    inspectorRequestId,
  ],
  (
    [mounted, _core, currentAgent, threadId, isExplicit, requestId],
    _old,
    onCleanup,
  ) => {
    if (!mounted || typeof window === "undefined" || !currentAgent) {
      return;
    }
    // Pins the thread on the agent before anything issues a request, and
    // connects a thread the caller picked. A switch to a fresh thread (a
    // "+ New" reset) empties the agent so the welcome screen shows; moving in
    // or out of an Inspector override stops the run.
    const handle = connection.open({
      agent: currentAgent,
      threadId,
      explicit: isExplicit,
      inspectorRequestId: requestId,
    });
    onCleanup(() => handle.release());
  },
  { immediate: true },
);

// The send side — queueing behind the run in flight and the thread's
// connection, the upload guard, stop, and transcription — lives in core.
const submitter = ɵcreateChatSubmitter({
  core: {
    get runtimeUrl() {
      return copilotkit.value.runtimeUrl;
    },
    get runtimeTransport() {
      return copilotkit.value.runtimeTransport;
    },
    get credentials() {
      return copilotkit.value.credentials;
    },
    resolveHeaders: () => copilotkit.value.resolveHeaders(),
    runAgent: (params) => copilotkit.value.runAgent(params),
    stopAgent: (params) => copilotkit.value.stopAgent(params),
  },
  getAgent: () => agent.value ?? undefined,
  input: {
    get: () => inputValue.value,
    set: (value) => {
      inputValue.value = value;
    },
  },
  attachments: {
    isUploading: () =>
      attachments.value.some((attachment) => attachment.status === "uploading"),
    consumeReady: consumeAttachments,
  },
  threads,
});
const submitterState = shallowRef(submitter.getSnapshot());
const unsubscribeSubmitter = submitter.subscribe(() => {
  submitterState.value = submitter.getSnapshot();
});
const isTranscribing = computed(() => submitterState.value.isTranscribing);
const transcriptionError = computed(() => {
  const { notice } = submitterState.value;
  return notice ? ɵresolveChatNotice(notice, chatLabels.value) : null;
});

onBeforeUnmount(() => {
  unsubscribeSubmitter();
  submitter.dispose();
  connection.dispose();
});

onMounted(() => {
  isMounted.value = true;
});

async function handleSubmitMessage(value: string) {
  // A send blocked by an upload shows its notice but is not reported.
  const isBlockedByUpload = attachments.value.some(
    (attachment) => attachment.status === "uploading",
  );
  if (!isBlockedByUpload) emit("submit-message", value);
  await submitter.submit(value);
}

async function handleSelectSuggestion(suggestion: Suggestion, index: number) {
  emit("select-suggestion", suggestion, index);
  await submitter.selectSuggestion(suggestion);
}

function stopCurrentRun() {
  submitter.stop();
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
  if (!showTranscription.value) {
    return;
  }
  submitter.showNotice(null);
  transcribeMode.value = "transcribe";
  emit("start-transcribe");
}

function handleCancelTranscribe() {
  if (!showTranscription.value) {
    return;
  }
  submitter.showNotice(null);
  transcribeMode.value = "input";
  emit("cancel-transcribe");
}

function handleFinishTranscribe() {
  if (!showTranscription.value) {
    return;
  }
  transcribeMode.value = "input";
  emit("finish-transcribe");
}

async function handleFinishTranscribeWithAudio(audioBlob: Blob) {
  if (!showTranscription.value) {
    return;
  }
  if (props.onFinishTranscribeWithAudio) {
    await props.onFinishTranscribeWithAudio(audioBlob);
    return;
  }

  await submitter.transcribe(audioBlob);
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
  toolCallDisplay: props.toolCallDisplay,
  messageFeedback: props.messageFeedback,
  canStop: shouldAllowStop.value,
  canAddFile: attachmentsEnabled.value,
  canTranscribe: showTranscription.value,
  onSubmitMessage: handleSubmitMessage,
  onStop: handleStop,
  onInputChange: handleInputChange,
  onSelectSuggestion: handleSelectSuggestion,
  onRemoveAttachment: removeAttachment,
  onAddFile: handleAddFile,
  onDragOver: attachmentsEnabled.value ? handleDragOver : undefined,
  onDragLeave: attachmentsEnabled.value ? handleDragLeave : undefined,
  onDrop: attachmentsEnabled.value ? handleDrop : undefined,
  onStartTranscribe: handleStartTranscribe,
  onCancelTranscribe: handleCancelTranscribe,
  onFinishTranscribe: handleFinishTranscribe,
  onFinishTranscribeWithAudio: handleFinishTranscribeWithAudio,
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
      <CopilotKitStyles />
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
          :tool-call-display="chatViewSlotProps.toolCallDisplay"
          :message-feedback="chatViewSlotProps.messageFeedback"
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
