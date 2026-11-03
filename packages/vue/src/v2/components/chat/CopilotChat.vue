<script setup lang="ts">
import { AGUIConnectNotImplementedError, AbstractAgent } from "@ag-ui/client";
import { DEFAULT_AGENT_ID, randomUUID } from "@copilotkit/shared";
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
  CopilotKitCoreErrorCode,
  ɵcreateChatSubmitter,
  ɵisHttpAgent,
  ɵresolveChatNotice,
  ɵThreadSwitchCoordinator,
} from "@copilotkit/core";
import type { Suggestion, ɵThreadSelection } from "@copilotkit/core";
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

const generatedThreadId = ref(randomUUID());
const transcribeMode = ref<"input" | "transcribe" | "processing">("input");
const inputValue = ref(props.inputValue ?? "");
const isMounted = ref(false);
const isUnmounting = ref(false);

type ActiveConnectCycle = {
  core: object;
  selection: ɵThreadSelection;
  abortController: AbortController;
  detached: boolean;
};

const activeConnectCycle = shallowRef<ActiveConnectCycle | null>(null);
// Keeps the agent on the thread this chat shows, orders the teardown of the
// previous thread, and tracks connections a send must wait for.
const threads = new ɵThreadSwitchCoordinator({
  stopAgent: (params) => copilotkit.value.stopAgent(params),
  subscribe: (subscriber) => copilotkit.value.subscribe(subscriber),
});

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
const baseThreadId = computed(
  () => providedThreadId.value ?? generatedThreadId.value,
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
const lastConnectedThreadId = ref<string | null>(null);
const isConnecting = computed(
  () =>
    hasExplicitThreadId.value &&
    lastConnectedThreadId.value !== resolvedThreadId.value,
);
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
    () => copilotkit.value,
    resolvedAgentId,
    resolvedThreadId,
    inspectorRequestId,
  ],
  ([core, agentId, threadId, requestId], _old, onCleanup) => {
    if (!requestId) return;
    const subscription = core.subscribe({
      onError: (event) => {
        if (event.code !== CopilotKitCoreErrorCode.AGENT_CONNECT_FAILED) return;
        if (event.context?.agentId !== agentId) return;
        if (event.context?.threadId !== threadId) return;
        failInspectorOverride(requestId);
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
    inspectorRequestId,
  ],
  (
    [mounted, core, currentAgent, threadId, isExplicit, requestId],
    _old,
    onCleanup,
  ) => {
    if (!mounted) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    if (!currentAgent) {
      return;
    }

    // Pins the thread on the agent before anything issues a request:
    // `CopilotKitCore.connectAgent` reads `agent.threadId` synchronously. A
    // switch to a fresh, non-explicit thread (a "+ New" reset) empties the
    // agent so the welcome screen shows; moving in or out of an inspector
    // override stops the run.
    const selection = threads.select({
      agent: currentAgent,
      threadId,
      explicit: isExplicit,
      inspectorRequestId: requestId,
    });

    // When the caller hasn't picked a specific thread, resolvedThreadId is
    // a UUID minted locally. The backend has never seen it, so /connect
    // would always 404 — skip the call. A real thread is only created
    // once the user runs the agent for the first time.
    if (!selection.shouldConnect) {
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
      existingCycle.selection === selection;

    let cycle: ActiveConnectCycle;
    if (hasSameDeps && existingCycle) {
      cycle = existingCycle;
    } else {
      const connectAbortController = new AbortController();
      cycle = {
        core: core as object,
        selection,
        abortController: connectAbortController,
        detached: false,
      };
      activeConnectCycle.value = cycle;

      // Tracked, so a send waits for the thread to load instead of racing it.
      void threads.trackConnection(selection, () =>
        threads
          .whenTornDown()
          .then(() => {
            if (cycle.detached) return;
            if (ɵisHttpAgent(currentAgent))
              currentAgent.abortController = connectAbortController;
            return core.connectAgent({ agent: currentAgent });
          })
          .catch((error: unknown) => {
            if (cycle.detached) {
              selection.clearDiscardedBaseline();
              return;
            }
            if (error instanceof AGUIConnectNotImplementedError) {
              return;
            }
            if (requestId) {
              failInspectorOverride(requestId);
            }
            // The coordinator logs the failure and blocks sends on it.
            throw error;
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
              selection.clearDiscardedBaseline();
              return;
            }
            const raf =
              typeof requestAnimationFrame === "function"
                ? requestAnimationFrame
                : (cb: () => void) => setTimeout(cb, 16);
            raf(() => {
              if (cycle.detached) return;
              lastConnectedThreadId.value = selection.threadId;
            });
          }),
      );
    }

    onCleanup(() => {
      const activeCycle = activeConnectCycle.value;
      if (!activeCycle || activeCycle !== cycle) {
        return;
      }

      const { selection: cycleSelection } = activeCycle;
      const shouldDetach =
        isUnmounting.value ||
        copilotkit.value !== activeCycle.core ||
        agent.value !== cycleSelection.agent ||
        resolvedThreadId.value !== cycleSelection.threadId;
      if (!shouldDetach) {
        return;
      }

      cycleSelection.release();
      activeCycle.detached = true;
      activeCycle.abortController.abort();
      void threads.detach(cycleSelection.agent);
      activeConnectCycle.value = null;
    });
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
  isUnmounting.value = true;
  unsubscribeSubmitter();
  submitter.dispose();
  threads.dispose();
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
