import { useAgent } from "../../hooks/use-agent";
import { useAttachments } from "../../hooks/use-attachments";
import { useSuggestions } from "../../hooks/use-suggestions";
import type { CopilotChatViewProps } from "./CopilotChatView";
import { CopilotChatView } from "./CopilotChatView";
import type { CopilotChatInputMode } from "./CopilotChatInput";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../../providers/CopilotChatConfigurationProvider";
import { randomUUID } from "@copilotkit/shared";
import type { AttachmentsConfig } from "@copilotkit/shared";
import {
  CopilotChatDefaultLabels,
  CopilotKitCoreErrorCode,
  CopilotKitCoreRuntimeConnectionStatus,
  ɵChatConnection,
  ɵcreateChatSubmitter,
  ɵcreateLastUserMessageTracker,
  ɵcreateThreadStore,
  ɵFreshThreadId,
  ɵmessagesFingerprint,
  ɵresolveAgentId,
  ɵresolveChatNotice,
  ɵsubscribeToAgentErrors,
} from "@copilotkit/core";
import type {
  CopilotChatLabels,
  Suggestion,
  ɵChatRunScope,
  ɵThreadRuntimeContext,
  ɵThreadStore,
} from "@copilotkit/core";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  useCopilotKit,
  useDefaultAgentId,
  useLicenseContext,
} from "../../context";
import { InlineFeatureWarning } from "../../components/license-warning-banner";
import type { SlotValue } from "../../lib/slots";
import { renderSlot, useShallowStableRef } from "../../lib/slots";
import { LastUserMessageContext } from "./last-user-message-context";
import type { LastUserMessageState } from "./last-user-message-context";
import { useInspectorThreadOverride } from "../../providers/use-inspector-thread-override";
import { GenerativeUIChatSlotContext } from "../../generative-ui/chat";
import type { GenerativeUIChatSurfaceProps } from "../../generative-ui/chat";
import {
  CopilotKitInspectorContextProvider,
  useCopilotKitInspector,
} from "../CopilotKitInspectorContext";
import { CopilotKitStyles } from "../../styles/copilot-kit-styles";

export type CopilotChatProps = Omit<
  CopilotChatViewProps,
  | "messages"
  | "isRunning"
  | "suggestions"
  | "suggestionLoadingIndexes"
  | "onSelectSuggestion"
  // Attachment state props — managed internally based on `attachments` config
  | "attachments"
  | "onRemoveAttachment"
  | "onAddFile"
  | "dragOver"
  | "onDragOver"
  | "onDragLeave"
  | "onDrop"
  // CopilotChat defines its own agent-error `onError` below and never passes
  // it to the view's <div>, so the DOM `onError` attribute is left out.
  | "onError"
  // Redeclared below, deprecated: the chat sets it from its own state
  | "inputMode"
> & {
  /**
   * @deprecated Has no effect. `CopilotChat` sets the input mode from its own
   * transcription state. To set it yourself, render `CopilotChatView` and pass
   * `inputMode` there.
   */
  inputMode?: CopilotChatViewProps["inputMode"];
  agentId?: string;
  threadId?: string;
  labels?: Partial<CopilotChatLabels>;
  /**
   * Enable Inspector message shortcuts for this chat (enabled by default).
   * An explicit CopilotKit provider enableInspector value takes priority.
   * Shortcuts only appear in local development while Inspector is visible.
   */
  inspectorTools?: boolean;
  /** Accepts a className, partial props, or any component with CopilotChatView props — static namespace members are not required. */
  chatView?: SlotValue<React.ComponentType<CopilotChatViewProps>>;
  isModalDefaultOpen?: boolean;
  /** Enable multimodal file attachments (images, audio, video, documents). */
  attachments?: AttachmentsConfig;
  /**
   * Error handler scoped to this chat's agent. Fires in addition to the
   * provider-level onError (does not suppress it). Receives only errors
   * whose context.agentId matches this chat's agent.
   */
  onError?: (event: {
    error: Error;
    code: CopilotKitCoreErrorCode;
    context: Record<string, any>;
  }) => void | Promise<void>;
  /**
   * Throttle interval (in milliseconds) for re-renders triggered by message
   * change notifications. Overrides the provider-level `defaultThrottleMs`
   * for this chat instance. Forwarded to the internal `useAgent()` hook,
   * which resolves the effective throttle value.
   *
   * @default undefined — inherits from provider `defaultThrottleMs`;
   * if that is also unset, re-renders are unthrottled. Note: passing
   * `throttleMs={0}` explicitly disables throttling for this instance
   * even when the provider specifies a non-zero `defaultThrottleMs`.
   */
  throttleMs?: number;
  /**
   * Experimental. Wrapper for generative UI surfaces rendered in this chat.
   * Receives `{ surfaceId, isStreaming, error, children }`.
   */
  generativeUISurface?: React.ComponentType<GenerativeUIChatSurfaceProps>;
};
export function CopilotChat({
  agentId,
  threadId,
  labels,
  inspectorTools,
  chatView,
  isModalDefaultOpen,
  attachments: attachmentsConfig,
  onError,
  throttleMs,
  generativeUISurface,
  ...props
}: CopilotChatProps) {
  // Check for existing configuration provider
  const existingConfig = useCopilotChatConfiguration();
  const inspector = useCopilotKitInspector();
  const inspectorContextValue = useMemo(
    () => ({
      ...inspector,
      isInspectorEnabled:
        inspector.isInspectorEnabled &&
        (inspector.providerEnableInspector ?? inspectorTools ?? true),
    }),
    [inspector, inspectorTools],
  );

  // Apply priority: props > existing config > defaults
  const providerAgentId = useDefaultAgentId();
  const resolvedAgentId = ɵresolveAgentId({
    agentId,
    chatAgentId: existingConfig?.agentId,
    providerAgentId,
  });
  const providedThreadId = threadId ?? existingConfig?.threadId;
  const [freshThreadId] = useState(() => new ɵFreshThreadId());
  const baseThreadId = useMemo(
    () => freshThreadId.resolve(providedThreadId),
    [freshThreadId, providedThreadId],
  );
  // "Explicit" means a caller actually picked this thread — via the
  // `threadId` prop on CopilotChat or a wrapping provider that marked its
  // threadId as caller-chosen. An auto-minted UUID leaking down through a
  // CopilotChatConfigurationProvider (e.g. from the v1 CopilotKit →
  // ThreadsProvider chain) does NOT count; treating it as explicit is
  // what made /connect fire against 404s and the welcome screen stay
  // hidden for fresh empty chats.
  const baseHasExplicitThreadId =
    !!threadId || !!existingConfig?.hasExplicitThreadId;
  const { inspectorThreadId, inspectorRequestId, failInspectorOverride } =
    useInspectorThreadOverride({
      agentId: resolvedAgentId,
      baseThreadId,
    });
  const resolvedThreadId = inspectorThreadId ?? baseThreadId;
  const hasExplicitThreadId =
    inspectorThreadId !== null || baseHasExplicitThreadId;

  const { agent, isReady } = useAgent({
    agentId: resolvedAgentId,
    throttleMs,
  });
  const { copilotkit } = useCopilotKit();
  const { suggestions: autoSuggestions } = useSuggestions({
    agentId: resolvedAgentId,
  });

  const { checkFeature } = useLicenseContext();
  const isChatLicensed = checkFeature("chat");

  useEffect(() => {
    if (!isChatLicensed) {
      console.warn(
        '[CopilotKit] Warning: "chat" feature is not licensed. Visit copilotkit.ai/pricing',
      );
    }
  }, [isChatLicensed]);

  // onError subscription — forward core errors scoped to this chat's agent
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!onErrorRef.current) return;
    return ɵsubscribeToAgentErrors(copilotkit, resolvedAgentId, (event) =>
      onErrorRef.current?.(event),
    );
  }, [copilotkit, resolvedAgentId]);

  // Loads the thread this chat shows. Owns the connect's abort, detach and
  // "connecting" state, and ends a failed Inspector override.
  const failInspectorOverrideRef = useRef(failInspectorOverride);
  failInspectorOverrideRef.current = failInspectorOverride;
  const [connection] = useState(
    () =>
      new ɵChatConnection({
        core: copilotkit,
        onInspectorOverrideFailed: (requestId) =>
          failInspectorOverrideRef.current(requestId),
      }),
  );
  const { threads } = connection;
  useSyncExternalStore(
    useCallback((onChange) => connection.subscribe(onChange), [connection]),
    () => connection.getSnapshot(),
    () => connection.getSnapshot(),
  );

  // Transcription state
  const [transcribeMode, setTranscribeMode] =
    useState<CopilotChatInputMode>("input");
  const [inputValue, setInputValue] = useState("");
  // The submitter reads and writes the input between renders (a transcript
  // appended after an await, a blocked send restored), so it goes through a
  // ref that is always the latest value.
  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;

  // Attachments
  const {
    attachments: selectedAttachments,
    enabled: attachmentsEnabled,
    dragOver,
    fileInputRef,
    containerRef: chatContainerRef,
    handleFileUpload,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeAttachment,
    consumeAttachments,
  } = useAttachments({ config: attachmentsConfig });

  // A send waits for the run in flight, so the submitter re-checks the
  // "uploading" guard after the wait against FRESH state, not this render's.
  const selectedAttachmentsRef = useRef(selectedAttachments);
  useEffect(() => {
    selectedAttachmentsRef.current = selectedAttachments;
  }, [selectedAttachments]);

  // Check if transcription is enabled
  const isTranscriptionEnabled = copilotkit.audioFileTranscriptionEnabled;

  // Check if browser supports MediaRecorder
  const isMediaRecorderSupported =
    typeof window !== "undefined" && typeof MediaRecorder !== "undefined";

  const {
    messageView: providedMessageView,
    suggestionView: providedSuggestionView,
    onStop: providedStopHandler,
    ...restProps
  } = props;

  // When the caller picked a thread, the welcome screen stays hidden until
  // its connect settles, so switching threads does not flash it while the
  // thread's messages load.
  const isConnecting = connection.isConnecting({
    threadId: resolvedThreadId,
    explicit: hasExplicitThreadId,
  });
  const activeConnectCountRef = useRef(0);
  const trackConnection = useCallback(
    (connect: () => Promise<void>) => {
      void connection.track(connect);
    },
    [connection],
  );
  const pendingRunActivityReconnectRef = useRef(false);
  const runActivityReconnectGenerationRef = useRef(0);
  const activeLocalRunIdsRef = useRef<Set<string>>(new Set());
  // In-flight runs this client started on the agent by any path (the input,
  // `copilotkit.runAgent`, a frontend-tool follow-up). Kept apart from
  // `activeLocalRunIdsRef`, whose pinned ids span a whole follow-up chain.
  const observedLocalRunIdsRef = useRef<Set<string>>(new Set());
  const recentlyLocalRunIdsRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const activeWakeRunIdsRef = useRef<Set<string>>(new Set());
  const recentlyWakeRunIdsRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const pendingWakeRunIdRef = useRef<string | undefined>(undefined);
  const startRunActivityReconnectRef = useRef<
    ((generation: number) => void) | null
  >(null);
  const runtimeStatus =
    copilotkit.runtimeConnectionStatus ===
    CopilotKitCoreRuntimeConnectionStatus.Connected
      ? "Connected"
      : copilotkit.runtimeConnectionStatus;
  const hasNativeIntelligenceRunActivity =
    hasExplicitThreadId &&
    runtimeStatus === "Connected" &&
    !!copilotkit.intelligence?.wsUrl &&
    copilotkit.threadEndpoints?.realtimeMetadata === true;
  const [standaloneRunActivityStore] = useState<ɵThreadStore>(() =>
    ɵcreateThreadStore({
      fetch: copilotkit.ɵruntimeFetch,
    }),
  );

  const rememberRecentlyLocalRunId = useCallback((runId: string) => {
    const existingTimeout = recentlyLocalRunIdsRef.current.get(runId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      recentlyLocalRunIdsRef.current.delete(runId);
    }, 30_000);
    recentlyLocalRunIdsRef.current.set(runId, timeout);
  }, []);

  const rememberRecentlyWakeRunId = useCallback((runId: string) => {
    const existingTimeout = recentlyWakeRunIdsRef.current.get(runId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      recentlyWakeRunIdsRef.current.delete(runId);
    }, 30_000);
    recentlyWakeRunIdsRef.current.set(runId, timeout);
  }, []);

  const isLocalActiveRunActivity = useCallback(
    (notification: { agentId?: string; runId?: string; eventType: string }) => {
      if (notification.agentId && notification.agentId !== resolvedAgentId) {
        return false;
      }
      if (
        !notification.runId ||
        (!activeLocalRunIdsRef.current.has(notification.runId) &&
          !observedLocalRunIdsRef.current.has(notification.runId) &&
          !recentlyLocalRunIdsRef.current.has(notification.runId))
      ) {
        return false;
      }

      const eventType = notification.eventType.toUpperCase();
      return (
        eventType === "RUN_STARTED" ||
        eventType === "RUN_FINISHED" ||
        eventType === "RUN_ERROR"
      );
    },
    [resolvedAgentId],
  );

  useEffect(() => {
    const recentlyLocalRunIds = recentlyLocalRunIdsRef.current;
    const recentlyWakeRunIds = recentlyWakeRunIdsRef.current;
    return () => {
      recentlyLocalRunIds.forEach((timeout) => {
        clearTimeout(timeout);
      });
      recentlyLocalRunIds.clear();
      recentlyWakeRunIds.forEach((timeout) => {
        clearTimeout(timeout);
      });
      recentlyWakeRunIds.clear();
    };
  }, []);

  useEffect(() => {
    // Pins the thread on the agent and connects a thread the caller picked.
    // A switch to a fresh thread (startNewThread, the drawer's "+ New")
    // empties the agent so the welcome screen shows; moving in or out of an
    // Inspector override stops the run. Release aborts a connect still
    // loading, which keeps StrictMode's remount from sending a second
    // /connect.
    const handle = connection.open(
      {
        agent,
        threadId: resolvedThreadId,
        explicit: hasExplicitThreadId,
        inspectorRequestId,
      },
      {
        onStart: () => {
          activeConnectCountRef.current += 1;
        },
        onSettled: (current) => {
          activeConnectCountRef.current = Math.max(
            0,
            activeConnectCountRef.current - 1,
          );
          if (!current || activeConnectCountRef.current !== 0) return;
          const startReconnect = startRunActivityReconnectRef.current;
          if (pendingRunActivityReconnectRef.current && startReconnect) {
            pendingRunActivityReconnectRef.current = false;
            startReconnect(runActivityReconnectGenerationRef.current);
          }
        },
      },
    );
    return () => handle.release();
  }, [
    connection,
    resolvedThreadId,
    agent,
    resolvedAgentId,
    hasExplicitThreadId,
    inspectorRequestId,
  ]);

  useEffect(() => {
    if (!hasNativeIntelligenceRunActivity) return;

    const registeredThreadStore = copilotkit.getThreadStore(resolvedAgentId);
    const threadStore = registeredThreadStore ?? standaloneRunActivityStore;
    if (!threadStore?.subscribeToRunActivity) return;
    const ownsStandaloneStore = registeredThreadStore === undefined;
    if (ownsStandaloneStore) {
      threadStore.start();
      const context: ɵThreadRuntimeContext | null = copilotkit.runtimeUrl
        ? {
            runtimeUrl: copilotkit.runtimeUrl,
            wsUrl: copilotkit.intelligence?.wsUrl,
            agentId: resolvedAgentId,
          }
        : null;
      threadStore.setContext(context);
    }

    const generation = runActivityReconnectGenerationRef.current + 1;
    runActivityReconnectGenerationRef.current = generation;
    let detached = false;
    let wakeReconnectActive = false;
    let pendingAgentIdleDrain: ReturnType<typeof setTimeout> | null = null;
    const hasActiveAgentRun = () =>
      activeLocalRunIdsRef.current.size > 0 || agent.isRunning;
    const scheduleAgentIdleDrain = () => {
      if (pendingAgentIdleDrain !== null) return;
      pendingAgentIdleDrain = setTimeout(() => {
        pendingAgentIdleDrain = null;
        if (
          detached ||
          runActivityReconnectGenerationRef.current !== generation ||
          !pendingRunActivityReconnectRef.current
        ) {
          return;
        }
        if (hasActiveAgentRun()) {
          scheduleAgentIdleDrain();
          return;
        }
        startRunActivityReconnectRef.current?.(generation);
      }, 10);
    };

    const connect = async () => {
      activeConnectCountRef.current += 1;
      wakeReconnectActive = true;
      const wakeRunId = pendingWakeRunIdRef.current;
      pendingWakeRunIdRef.current = undefined;
      if (wakeRunId) {
        activeWakeRunIdsRef.current.add(wakeRunId);
      }
      let didConnect = false;
      try {
        await copilotkit.connectAgent({ agent });
        didConnect = true;
      } catch (error) {
        if (!detached) throw error;
      } finally {
        if (wakeRunId) {
          activeWakeRunIdsRef.current.delete(wakeRunId);
          if (didConnect) {
            rememberRecentlyWakeRunId(wakeRunId);
          }
        }
        activeConnectCountRef.current = Math.max(
          0,
          activeConnectCountRef.current - 1,
        );
        wakeReconnectActive = false;
        const canDrainPendingReconnect =
          !detached &&
          runActivityReconnectGenerationRef.current === generation &&
          activeConnectCountRef.current === 0;

        if (
          canDrainPendingReconnect &&
          pendingRunActivityReconnectRef.current
        ) {
          pendingRunActivityReconnectRef.current = false;
          trackConnection(connect);
        }
      }
    };

    startRunActivityReconnectRef.current = (requestedGeneration) => {
      if (
        detached ||
        requestedGeneration !== generation ||
        runActivityReconnectGenerationRef.current !== generation
      ) {
        return;
      }
      if (hasActiveAgentRun()) {
        pendingRunActivityReconnectRef.current = true;
        scheduleAgentIdleDrain();
        return;
      }
      if (activeConnectCountRef.current > 0) {
        if (!wakeReconnectActive) {
          pendingRunActivityReconnectRef.current = true;
        }
        return;
      }
      pendingRunActivityReconnectRef.current = false;
      trackConnection(connect);
    };

    const subscription = threadStore.subscribeToRunActivity((notification) => {
      if (notification.threadId !== resolvedThreadId) return;
      if (notification.agentId && notification.agentId !== resolvedAgentId) {
        return;
      }
      if (isLocalActiveRunActivity(notification)) return;
      if (
        notification.runId &&
        (activeWakeRunIdsRef.current.has(notification.runId) ||
          recentlyWakeRunIdsRef.current.has(notification.runId))
      ) {
        return;
      }
      pendingWakeRunIdRef.current = notification.runId;
      startRunActivityReconnectRef.current?.(generation);
    });

    const observedLocalRunIds = observedLocalRunIdsRef.current;
    const localRunSubscription = agent.subscribe({
      onRunInitialized: ({ input }) => {
        observedLocalRunIds.add(input.runId);
      },
      onRunFinalized: ({ input }) => {
        observedLocalRunIds.delete(input.runId);
        rememberRecentlyLocalRunId(input.runId);
      },
    });

    return () => {
      detached = true;
      pendingRunActivityReconnectRef.current = false;
      pendingWakeRunIdRef.current = undefined;
      if (pendingAgentIdleDrain !== null) {
        clearTimeout(pendingAgentIdleDrain);
        pendingAgentIdleDrain = null;
      }
      if (startRunActivityReconnectRef.current) {
        startRunActivityReconnectRef.current = null;
      }
      if (wakeReconnectActive) {
        agent.detachActiveRun().catch(() => {});
      }
      activeWakeRunIdsRef.current.clear();
      subscription.unsubscribe();
      localRunSubscription.unsubscribe();
      if (ownsStandaloneStore) {
        threadStore.setContext(null);
        threadStore.stop();
      }
    };
    // copilotkit is intentionally excluded — it is a stable ref that never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    agent,
    resolvedAgentId,
    resolvedThreadId,
    hasExplicitThreadId,
    hasNativeIntelligenceRunActivity,
    copilotkit.runtimeConnectionStatus,
    copilotkit.runtimeUrl,
    copilotkit.ɵheadersGeneration,
    copilotkit.intelligence?.wsUrl,
    copilotkit.threadEndpoints?.realtimeMetadata,
    standaloneRunActivityStore,
    isLocalActiveRunActivity,
    rememberRecentlyLocalRunId,
    rememberRecentlyWakeRunId,
    trackConnection,
  ]);

  // Each send gets a fresh Intelligence run id, so the run-activity stream can
  // tell this client's own runs from runs started elsewhere.
  const prepareRun = (): ɵChatRunScope => {
    const localRunId = hasNativeIntelligenceRunActivity
      ? randomUUID()
      : undefined;
    if (localRunId) activeLocalRunIdsRef.current.add(localRunId);
    return {
      runId: localRunId,
      settle: () => {
        if (localRunId) {
          activeLocalRunIdsRef.current.delete(localRunId);
          rememberRecentlyLocalRunId(localRunId);
        }
        const startReconnect = startRunActivityReconnectRef.current;
        const canReconnect =
          pendingRunActivityReconnectRef.current &&
          activeLocalRunIdsRef.current.size === 0 &&
          activeConnectCountRef.current === 0 &&
          startReconnect !== null;
        if (canReconnect) {
          pendingRunActivityReconnectRef.current = false;
          startReconnect(runActivityReconnectGenerationRef.current);
        }
      },
    };
  };
  const prepareRunRef = useRef(prepareRun);
  prepareRunRef.current = prepareRun;
  const agentRef = useRef(agent);
  agentRef.current = agent;

  // The send side — queueing behind the run in flight and the thread's
  // connection, the upload guard, stop, and transcription — lives in core.
  const [submitter] = useState(() =>
    ɵcreateChatSubmitter({
      core: copilotkit,
      getAgent: () => agentRef.current,
      input: {
        get: () => inputValueRef.current,
        set: (value) => {
          inputValueRef.current = value;
          setInputValue(value);
        },
      },
      attachments: {
        isUploading: () =>
          selectedAttachmentsRef.current.some((a) => a.status === "uploading"),
        consumeReady: consumeAttachments,
      },
      threads,
      prepareRun: () => prepareRunRef.current(),
    }),
  );
  const { notice, isTranscribing } = useSyncExternalStore(
    useCallback((onChange) => submitter.subscribe(onChange), [submitter]),
    () => submitter.getSnapshot(),
    () => submitter.getSnapshot(),
  );
  // Clears the notice timer on unmount. Not `dispose()`: StrictMode remounts
  // the same component instance, which keeps its submitter.
  useEffect(() => () => submitter.showNotice(null), [submitter]);

  // The view and DOM props expect void callbacks, so these handlers keep
  // the submitter's and the attachment handlers' promises fire-and-forget.
  const onSubmitInput = useCallback(
    (value: string) => {
      void submitter.submit(value);
    },
    [submitter],
  );

  const handleSelectSuggestion = useCallback(
    (suggestion: Suggestion) => {
      void submitter.selectSuggestion(suggestion);
    },
    [submitter],
  );

  const dropFiles = useCallback(
    (e: React.DragEvent) => {
      void handleDrop(e);
    },
    [handleDrop],
  );
  const uploadFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void handleFileUpload(e);
    },
    [handleFileUpload],
  );

  const stopCurrentRun = useCallback(() => submitter.stop(), [submitter]);

  // Transcription handlers
  const handleStartTranscribe = useCallback(() => {
    submitter.showNotice(null);
    setTranscribeMode("transcribe");
  }, [submitter]);

  const handleCancelTranscribe = useCallback(() => {
    submitter.showNotice(null);
    setTranscribeMode("input");
  }, [submitter]);

  const handleFinishTranscribe = useCallback(() => {
    setTranscribeMode("input");
  }, []);

  // Transcribe the audio blob from CopilotChatInput into the input
  const handleFinishTranscribeWithAudio = useCallback(
    (audioBlob: Blob) => submitter.transcribe(audioBlob),
    [submitter],
  );

  // Stabilize slot object references so inline props (new object reference on
  // every parent render) don't defeat MemoizedSlotWrapper's shallow equality
  // check and cause unnecessary re-renders of the message list on each keystroke.
  const stableMessageView = useShallowStableRef(
    typeof providedMessageView === "string"
      ? { className: providedMessageView }
      : providedMessageView,
  );
  const stableSuggestionView = useShallowStableRef(providedSuggestionView);

  // Stabilize the `onAddFile` handler. Without useCallback, a new arrow
  // function is created inline on every render, causing CopilotChatView to
  // re-render on every keystroke even when nothing else changed.
  const handleAddFile = useCallback(() => {
    // Delay to let Radix dropdown menu close before triggering file input
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 100);
  }, []);

  // Use shallow spread instead of ts-deepmerge. ts-deepmerge deep-clones plain
  // objects even from a single source, which would defeat the reference
  // stability we just established for stableMessageView and other slot values.
  const mergedProps: Partial<CopilotChatViewProps> = {
    isRunning: agent.isRunning,
    // HIDE suggestion pills until the runtime is ready, mirroring the
    // `onSubmitMessage` gate below. Static `available:"always"` pills render
    // during the provisional window (before `/info` swaps the real agent in),
    // so a click before `isReady` would commit `suggestion.message` to the
    // doomed provisional agent and run against it — the same empty-assistant
    // loss the typed-message gate prevents. Withholding `onSelectSuggestion`
    // alone leaves the pill VISUALLY ENABLED but inert (a click silently drops
    // the user's intent), so instead we do not surface the pills at all until
    // the real agent is bound: passing an empty list keeps `hasSuggestions`
    // false in the view (the same mechanism that hides pills while connecting /
    // running). Once `isReady` flips true the real suggestions appear and the
    // handler goes live. The `onSelectSuggestion` gate is retained as
    // defense-in-depth for any custom chatView slot that renders its own pills.
    suggestions: isReady ? autoSuggestions : [],
    onSelectSuggestion: isReady ? handleSelectSuggestion : undefined,
    suggestionView: stableSuggestionView,
    ...restProps,
  };
  if (stableMessageView !== undefined)
    mergedProps.messageView = stableMessageView;

  const hasMessages = agent.messages.length > 0;
  const shouldAllowStop = agent.isRunning && hasMessages;
  const effectiveStopHandler = shouldAllowStop
    ? (providedStopHandler ?? stopCurrentRun)
    : providedStopHandler;

  // Determine if transcription feature should be available
  const showTranscription = isTranscriptionEnabled && isMediaRecorderSupported;

  // Determine mode: transcribing takes priority, then transcribe mode, then default to input
  const effectiveMode: CopilotChatInputMode = isTranscribing
    ? "processing"
    : transcribeMode;

  // Memoize messages array — only create a new reference when content changes.
  // The fingerprint is cheaper than a deep compare: it keeps base64 uploads out
  // of the key, and still changes for streamed text, streamed tool arguments,
  // added parts, and replaced activity content.
  const messagesMemoKey = ɵmessagesFingerprint(agent.messages);
  const messages = useMemo(
    () => [...agent.messages],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messagesMemoKey],
  );

  // The latest user message and a send counter, for pin-to-send scrolling.
  // Messages the chat starts with (a restored thread) do not count as a send.
  // `update` keeps the same object until the last user message changes, so
  // calling it during render is safe.
  const [lastUserMessageTracker] = useState(() =>
    ɵcreateLastUserMessageTracker(messages),
  );
  const lastUserMessageState: LastUserMessageState =
    lastUserMessageTracker.update(messages);

  const finalProps: CopilotChatViewProps = {
    ...mergedProps,
    messages,
    // Input behavior props
    // Gate submission on runtime readiness. While `isReady` is false the
    // `agent` returned by useAgent is a provisional stand-in that `/info` will
    // swap out; a message committed to it (and the composer cleared) is lost
    // on that swap, surfacing as an empty assistant response. Withholding
    // `onSubmitMessage` disables the send control (canSend keys off it) and
    // makes Enter a no-op that preserves the composer text until the real
    // agent is bound.
    onSubmitMessage: isReady ? onSubmitInput : undefined,
    onStop: effectiveStopHandler,
    inputMode: effectiveMode,
    inputValue,
    onInputChange: setInputValue,
    // Only provide transcription handlers if feature is available
    onStartTranscribe: showTranscription ? handleStartTranscribe : undefined,
    onCancelTranscribe: showTranscription ? handleCancelTranscribe : undefined,
    onFinishTranscribe: showTranscription ? handleFinishTranscribe : undefined,
    onFinishTranscribeWithAudio: showTranscription
      ? handleFinishTranscribeWithAudio
      : undefined,
    // Attachment props
    attachments: selectedAttachments,
    onRemoveAttachment: removeAttachment,
    onAddFile: attachmentsEnabled ? handleAddFile : undefined,
    dragOver,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: dropFiles,
    isConnecting,
    hasExplicitThreadId,
  };

  // Always create a provider with merged values
  // This ensures priority: props > existing config > defaults
  const RenderedChatView = renderSlot(chatView, CopilotChatView, finalProps);

  return (
    <CopilotChatConfigurationProvider
      agentId={resolvedAgentId}
      threadId={resolvedThreadId}
      hasExplicitThreadId={hasExplicitThreadId}
      labels={labels}
      isModalDefaultOpen={isModalDefaultOpen}
    >
      <div ref={chatContainerRef} style={{ display: "contents" }}>
        <CopilotKitStyles />
        {attachmentsEnabled && (
          <input
            type="file"
            multiple
            ref={fileInputRef}
            onChange={uploadFiles}
            accept={attachmentsConfig?.accept ?? "*/*"}
            style={{ display: "none" }}
          />
        )}
        {!isChatLicensed && <InlineFeatureWarning featureName="Chat" />}
        {notice && (
          <div
            style={{
              position: "absolute",
              bottom: "100px",
              left: "50%",
              transform: "translateX(-50%)",
              backgroundColor: "#ef4444",
              color: "white",
              padding: "8px 16px",
              borderRadius: "8px",
              fontSize: "14px",
              zIndex: 50,
            }}
          >
            {ɵresolveChatNotice(notice, {
              ...CopilotChatDefaultLabels,
              ...existingConfig?.labels,
              ...labels,
            })}
          </div>
        )}
        <LastUserMessageContext.Provider value={lastUserMessageState}>
          <CopilotKitInspectorContextProvider value={inspectorContextValue}>
            <GenerativeUIChatSlotContext.Provider value={generativeUISurface}>
              {RenderedChatView}
            </GenerativeUIChatSlotContext.Provider>
          </CopilotKitInspectorContextProvider>
        </LastUserMessageContext.Provider>
      </div>
    </CopilotChatConfigurationProvider>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotChat {
  export const View = CopilotChatView;
}
