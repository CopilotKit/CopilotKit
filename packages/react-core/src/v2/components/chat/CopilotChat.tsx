import { useAgent } from "../../hooks/use-agent";
import { useAttachments } from "../../hooks/use-attachments";
import { useSuggestions } from "../../hooks/use-suggestions";
import type { CopilotChatViewProps } from "./CopilotChatView";
import { CopilotChatView } from "./CopilotChatView";
import type { CopilotChatInputMode } from "./CopilotChatInput";
import type { CopilotChatLabels } from "../../providers/CopilotChatConfigurationProvider";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../../providers/CopilotChatConfigurationProvider";
import {
  DEFAULT_AGENT_ID,
  randomUUID,
  TranscriptionErrorCode,
} from "@copilotkit/shared";
import type { AttachmentsConfig, InputContent } from "@copilotkit/shared";
import type { Suggestion, CopilotKitCoreErrorCode } from "@copilotkit/core";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  isRunCompletionAware,
  ɵcreateThreadStore,
} from "@copilotkit/core";
import type { ɵThreadRuntimeContext, ɵThreadStore } from "@copilotkit/core";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCopilotKit, useLicenseContext } from "../../context";
import { InlineFeatureWarning } from "../../components/license-warning-banner";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import type { SlotValue } from "../../lib/slots";
import { renderSlot, useShallowStableRef } from "../../lib/slots";
import {
  transcribeAudio,
  TranscriptionError,
} from "../../lib/transcription-client";
import { LastUserMessageContext } from "./last-user-message-context";
import type { LastUserMessageState } from "./last-user-message-context";

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
> & {
  agentId?: string;
  threadId?: string;
  labels?: Partial<CopilotChatLabels>;
  chatView?: SlotValue<typeof CopilotChatView>;
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
};
export function CopilotChat({
  agentId,
  threadId,
  labels,
  chatView,
  isModalDefaultOpen,
  attachments: attachmentsConfig,
  onError,
  throttleMs,
  ...props
}: CopilotChatProps) {
  // Check for existing configuration provider
  const existingConfig = useCopilotChatConfiguration();

  // Apply priority: props > existing config > defaults
  const resolvedAgentId =
    agentId ?? existingConfig?.agentId ?? DEFAULT_AGENT_ID;
  const providedThreadId = threadId ?? existingConfig?.threadId;
  const resolvedThreadId = useMemo(
    () => providedThreadId ?? randomUUID(),
    [providedThreadId],
  );
  // "Explicit" means a caller actually picked this thread — via the
  // `threadId` prop on CopilotChat or a wrapping provider that marked its
  // threadId as caller-chosen. An auto-minted UUID leaking down through a
  // CopilotChatConfigurationProvider (e.g. from the v1 CopilotKit →
  // ThreadsProvider chain) does NOT count; treating it as explicit is
  // what made /connect fire against 404s and the welcome screen stay
  // hidden for fresh empty chats.
  const hasExplicitThreadId =
    !!threadId || !!existingConfig?.hasExplicitThreadId;

  const { agent } = useAgent({
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

    const subscription = copilotkit.subscribe({
      onError: (event) => {
        // Only forward errors that match this chat's agent
        if (
          event.context?.agentId === resolvedAgentId ||
          !event.context?.agentId
        ) {
          onErrorRef.current?.({
            error: event.error,
            code: event.code,
            context: event.context,
          });
        }
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [copilotkit, resolvedAgentId]);

  // Transcription state
  const [transcribeMode, setTranscribeMode] =
    useState<CopilotChatInputMode>("input");
  const [inputValue, setInputValue] = useState("");
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null,
  );
  const [isTranscribing, setIsTranscribing] = useState(false);

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

  // onSubmitInput awaits an in-flight run before sending the new message, so
  // it must re-check the "uploading" guard against FRESH state AFTER the await
  // — the closure-captured `selectedAttachments` is stale across the await
  // (an upload can start during the wait).
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

  // Tracks the last threadId for which connectAgent has completed (success or
  // failure). When the user supplies a threadId, we're in "resume existing
  // thread" mode — the welcome screen should be suppressed until the connect
  // resolves, otherwise switching threads flashes the welcome screen while the
  // new thread's messages are still en route.
  const [lastConnectedThreadId, setLastConnectedThreadId] = useState<
    string | null
  >(null);
  const isConnecting =
    hasExplicitThreadId && lastConnectedThreadId !== resolvedThreadId;
  const activeConnectCountRef = useRef(0);
  const pendingRunActivityReconnectRef = useRef(false);
  const runActivityReconnectGenerationRef = useRef(0);
  const activeLocalRunIdsRef = useRef<Set<string>>(new Set());
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
      fetch: globalThis.fetch,
    }),
  );

  // Tracks the threadId the connect effect last ran for, so it can tell a real
  // thread SWITCH from an incidental re-render (agent identity change, etc.).
  const previousThreadIdRef = useRef<string | null>(null);

  // Latest explicitness, readable from an async connect that may resolve after
  // the user has already switched threads (see the stale-connect guard below).
  const hasExplicitThreadIdRef = useRef(hasExplicitThreadId);
  hasExplicitThreadIdRef.current = hasExplicitThreadId;

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
    const threadChanged = previousThreadIdRef.current !== resolvedThreadId;
    previousThreadIdRef.current = resolvedThreadId;

    // Non-explicit threads skip /connect, but the first runAgent still has to
    // ship the same SDK-generated threadId that the chat UI is rendering.
    agent.threadId = resolvedThreadId;

    // When the caller hasn't picked a specific thread, resolvedThreadId is a
    // UUID minted locally (either in this CopilotChat or in a wrapping
    // ThreadsProvider). The backend has never seen it, so /connect would
    // always 404 — skip the call. A real thread is only created once the
    // user runs the agent for the first time.
    if (!hasExplicitThreadId) {
      // Switching to a fresh, non-backend thread (e.g. startNewThread / the
      // drawer's "+ New"): there are no messages to /connect for, so drop any
      // messages carried over from the previously-viewed thread and fall back
      // to the welcome screen. Guard on an actual threadId change so re-renders
      // of the current thread (including its first run) never wipe an
      // in-progress conversation.
      if (threadChanged && agent.messages.length > 0) {
        agent.setMessages([]);
      }
      return;
    }

    let detached = false;

    // Create a fresh AbortController so we can cancel the HTTP request on cleanup.
    // HttpAgent (parent of ProxiedCopilotRuntimeAgent) uses this.abortController.signal
    // in its fetch config. Unlike runAgent(), connectAgent() does NOT create a new
    // AbortController automatically, so we must set one before connecting.
    const connectAbortController = new AbortController();
    if (agent instanceof HttpAgent) {
      agent.abortController = connectAbortController;
    }

    const connect = async (agentToConnect: AbstractAgent) => {
      activeConnectCountRef.current += 1;
      try {
        await copilotkit.connectAgent({ agent: agentToConnect });
      } catch (error) {
        // Ignore errors from aborted connections (e.g., React StrictMode cleanup)
        if (detached) return;
        // connectAgent already emits via the subscriber system, but catch
        // here to prevent unhandled rejections from unexpected errors.
        console.error("CopilotChat: connectAgent failed", error);
      } finally {
        // Whether the connect succeeded or failed, we're no longer in the
        // transitional "connecting" state for this thread — unblock the
        // welcome-screen-suppression so the view can settle.
        //
        // Defer one animation frame so any trailing React commits from the
        // bootstrap replay (final assistant message content) paint before
        // isConnecting flips off. Without this, suggestions + copy button
        // can briefly appear against an incompletely-laid-out message tree
        // and visibly snap once the last text chunk lands.
        if (!detached) {
          const raf =
            typeof requestAnimationFrame === "function"
              ? requestAnimationFrame
              : (cb: () => void) => setTimeout(cb, 16);
          raf(() => {
            if (!detached) setLastConnectedThreadId(resolvedThreadId);
          });
        } else if (!hasExplicitThreadIdRef.current) {
          // This connect was superseded (the user switched away while it was
          // still loading). If the now-current thread is a fresh non-explicit
          // one (e.g. the drawer's "+ New"), any snapshot this connect managed
          // to apply is stale — clear it so the welcome screen shows instead of
          // the abandoned thread's messages. A switch to ANOTHER explicit thread
          // is left alone: that thread's own connect owns the message reset.
          agentToConnect.setMessages([]);
        }
        activeConnectCountRef.current = Math.max(
          0,
          activeConnectCountRef.current - 1,
        );
        if (!detached && activeConnectCountRef.current === 0) {
          const startReconnect = startRunActivityReconnectRef.current;
          if (pendingRunActivityReconnectRef.current && startReconnect) {
            pendingRunActivityReconnectRef.current = false;
            startReconnect(runActivityReconnectGenerationRef.current);
          }
        }
      }
    };
    connect(agent);
    return () => {
      // Abort the HTTP request and detach the active run.
      // This is critical for React StrictMode which unmounts+remounts in dev,
      // preventing duplicate /connect requests from reaching the server.
      detached = true;
      connectAbortController.abort();
      // The .catch() is required to prevent a false-positive "Uncaught (in promise)
      // AbortError" in browser devtools. detachActiveRun() itself does not reject,
      // but without an attached handler V8 flags the promise chain as unhandled
      // when the abort signal propagates through connected promises internally.
      void agent.detachActiveRun().catch(() => {});
    };
    // copilotkit is intentionally excluded — it is a stable ref that never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedThreadId, agent, resolvedAgentId, hasExplicitThreadId]);

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
            headers: { ...copilotkit.headers },
            getMetadataSocket: (joinToken) =>
              copilotkit.ɵgetMetadataSocket(joinToken) ?? null,
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
        if (!detached) {
          console.error("CopilotChat: run activity reconnect failed", error);
        }
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
          connect();
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
      connect();
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
    copilotkit.headers,
    copilotkit.intelligence?.wsUrl,
    copilotkit.threadEndpoints?.realtimeMetadata,
    standaloneRunActivityStore,
    isLocalActiveRunActivity,
    rememberRecentlyWakeRunId,
  ]);

  // Serializes consecutive sends: if a run is already in flight, let it finish
  // before dispatching the next message instead of pre-empting it.
  // `copilotkit.runAgent` would otherwise call `agent.detachActiveRun()` and
  // ABORT the in-flight run. That abort is harmful when the in-flight run is an
  // interrupt RESUME: the resume re-enters and completes the paused agent
  // graph, and aborting it mid-flight leaves the graph paused — so the new
  // message lands as another resume of the SAME paused graph (re-interrupting
  // with no fresh payload) instead of starting a clean new turn. This is the
  // consecutive-interrupt regression: pick turn-1's slot (kicks off the
  // resume), then immediately send turn-2's message — without waiting, turn-2
  // aborts the resume and the 2nd interrupt's card never mounts. Awaiting the
  // active run's completion serializes the two turns so the resume finishes
  // (graph completes) before the new message starts a fresh run.
  //
  // The completion promise lives only on `IntelligenceAgent` (via the
  // `RunCompletionAware` contract), not on the `AbstractAgent` type held here —
  // so it is reached through a type guard, not a cast. Agents that don't
  // implement the contract degrade safely (the await is skipped).
  const waitForActiveRunToSettle = useCallback(async () => {
    // Widen to `unknown` before the guard: narrowing `AbstractAgent` directly
    // would intersect with its PRIVATE `activeRunCompletionPromise` declaration
    // and collapse the narrowed type to `never`.
    const maybeAware: unknown = agent;
    const activeRunCompletionPromise = isRunCompletionAware(maybeAware)
      ? maybeAware.activeRunCompletionPromise
      : undefined;
    if (agent.isRunning && activeRunCompletionPromise) {
      try {
        await activeRunCompletionPromise;
      } catch (error) {
        // The in-flight run rejected — proceed with the new send anyway,
        // but log so a chronically-failing in-flight run is observable.
        console.error(
          "CopilotChat: in-flight run rejected while queuing send",
          error,
        );
      }
    }
  }, [agent]);

  const onSubmitInput = useCallback(
    async (value: string) => {
      // Block if uploads in progress (fast fail against current state before
      // the value is committed — re-checked against live state after the
      // await below, since an upload can start during the wait).
      if (
        selectedAttachmentsRef.current.some((a) => a.status === "uploading")
      ) {
        console.error(
          "[CopilotKit] Cannot send while attachments are uploading (pre-await guard)",
        );
        setTranscriptionError("Cannot send while attachments are uploading.");
        return;
      }

      // Clear the input immediately so the composer reflects the accepted send
      // even though the actual dispatch may be deferred behind the in-flight
      // run. If the post-await guard later BLOCKS the send (e.g. an upload
      // starts during the await), the typed text is RESTORED to the composer
      // below so it is never silently lost.
      setInputValue("");

      // If a run is already in flight, let it finish before sending the new
      // message instead of pre-empting it (see waitForActiveRunToSettle).
      await waitForActiveRunToSettle();

      // Re-check the uploading guard against LIVE attachment state: an upload
      // can start (or stay in flight) during the await above, so a snapshot
      // taken before the await could consume an attachment with an incomplete
      // source. On block, RESTORE the typed text to the composer (it was
      // optimistically cleared on accept) so the user's input is not silently
      // lost, and surface a user-visible banner — console.error alone is
      // invisible to the user.
      if (
        selectedAttachmentsRef.current.some((a) => a.status === "uploading")
      ) {
        console.error(
          "[CopilotKit] Cannot send while attachments are uploading (post-await re-check)",
        );
        setTranscriptionError("Cannot send while attachments are uploading.");
        setInputValue(value);
        return;
      }

      const readyAttachments = consumeAttachments();

      if (readyAttachments.length > 0) {
        const contentParts: InputContent[] = [];
        if (value.trim()) {
          contentParts.push({ type: "text", text: value });
        }
        for (const att of readyAttachments) {
          contentParts.push({
            type: att.type,
            source: att.source,
            metadata: {
              ...(att.filename ? { filename: att.filename } : {}),
              ...att.metadata,
            },
          } as InputContent);
        }
        agent.addMessage({
          id: randomUUID(),
          role: "user",
          content: contentParts,
        });
      } else {
        agent.addMessage({
          id: randomUUID(),
          role: "user",
          content: value,
        });
      }

      const localRunId = hasNativeIntelligenceRunActivity
        ? randomUUID()
        : undefined;
      if (localRunId) {
        activeLocalRunIdsRef.current.add(localRunId);
      }

      try {
        await copilotkit.runAgent({
          agent,
          ...(localRunId !== undefined ? { runId: localRunId } : {}),
        });
      } catch (error) {
        console.error("CopilotChat: runAgent failed", error);
      } finally {
        if (localRunId) {
          activeLocalRunIdsRef.current.delete(localRunId);
          rememberRecentlyLocalRunId(localRunId);
        }
        if (
          pendingRunActivityReconnectRef.current &&
          activeLocalRunIdsRef.current.size === 0 &&
          activeConnectCountRef.current === 0
        ) {
          const startReconnect = startRunActivityReconnectRef.current;
          if (startReconnect) {
            pendingRunActivityReconnectRef.current = false;
            startReconnect(runActivityReconnectGenerationRef.current);
          }
        }
      }
    },
    // copilotkit is intentionally excluded — it is a stable ref that never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      agent,
      consumeAttachments,
      waitForActiveRunToSettle,
      hasNativeIntelligenceRunActivity,
      rememberRecentlyLocalRunId,
    ],
  );

  const handleSelectSuggestion = useCallback(
    async (suggestion: Suggestion) => {
      // Mirror onSubmitInput's send-serialization: if a run is in flight, wait
      // for it to settle before dispatching, so selecting a suggestion mid-run
      // does NOT pre-empt/abort the active run (the same #5195 fix the
      // typed-Enter path got — here for the suggestion path).
      await waitForActiveRunToSettle();

      agent.addMessage({
        id: randomUUID(),
        role: "user",
        content: suggestion.message,
      });

      const localRunId = hasNativeIntelligenceRunActivity
        ? randomUUID()
        : undefined;
      if (localRunId) {
        activeLocalRunIdsRef.current.add(localRunId);
      }

      try {
        await copilotkit.runAgent({
          agent,
          ...(localRunId !== undefined ? { runId: localRunId } : {}),
        });
      } catch (error) {
        console.error(
          "CopilotChat: runAgent failed after selecting suggestion",
          error,
        );
      } finally {
        if (localRunId) {
          activeLocalRunIdsRef.current.delete(localRunId);
          rememberRecentlyLocalRunId(localRunId);
        }
        if (
          pendingRunActivityReconnectRef.current &&
          activeLocalRunIdsRef.current.size === 0 &&
          activeConnectCountRef.current === 0
        ) {
          const startReconnect = startRunActivityReconnectRef.current;
          if (startReconnect) {
            pendingRunActivityReconnectRef.current = false;
            startReconnect(runActivityReconnectGenerationRef.current);
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      agent,
      waitForActiveRunToSettle,
      hasNativeIntelligenceRunActivity,
      rememberRecentlyLocalRunId,
    ],
  );

  const stopCurrentRun = useCallback(() => {
    try {
      copilotkit.stopAgent({ agent });
    } catch (error) {
      console.error("CopilotChat: stopAgent failed", error);
      try {
        agent.abortRun();
      } catch (abortError) {
        console.error("CopilotChat: abortRun fallback failed", abortError);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);

  // Transcription handlers
  const handleStartTranscribe = useCallback(() => {
    setTranscriptionError(null);
    setTranscribeMode("transcribe");
  }, []);

  const handleCancelTranscribe = useCallback(() => {
    setTranscriptionError(null);
    setTranscribeMode("input");
  }, []);

  const handleFinishTranscribe = useCallback(() => {
    setTranscribeMode("input");
  }, []);

  // Handle audio blob from CopilotChatInput and transcribe it
  const handleFinishTranscribeWithAudio = useCallback(
    async (audioBlob: Blob) => {
      setIsTranscribing(true);
      try {
        setTranscriptionError(null);

        // Send to transcription endpoint
        const result = await transcribeAudio(copilotkit, audioBlob);

        // Insert transcribed text into input
        setInputValue((prev) => {
          const trimmedPrev = prev.trim();
          if (trimmedPrev) {
            return `${trimmedPrev} ${result.text}`;
          }
          return result.text;
        });
      } catch (error) {
        console.error("CopilotChat: Transcription failed", error);

        // Show contextual error message based on error type
        if (error instanceof TranscriptionError) {
          const { code, retryable, message } = error.info;
          switch (code) {
            case TranscriptionErrorCode.RATE_LIMITED:
              setTranscriptionError("Too many requests. Please wait a moment.");
              break;
            case TranscriptionErrorCode.AUTH_FAILED:
              setTranscriptionError(
                "Authentication error. Please check your configuration.",
              );
              break;
            case TranscriptionErrorCode.AUDIO_TOO_LONG:
              setTranscriptionError(
                "Recording is too long. Please try a shorter recording.",
              );
              break;
            case TranscriptionErrorCode.AUDIO_TOO_SHORT:
              setTranscriptionError(
                "Recording is too short. Please try again.",
              );
              break;
            case TranscriptionErrorCode.INVALID_AUDIO_FORMAT:
              setTranscriptionError("Audio format not supported.");
              break;
            case TranscriptionErrorCode.SERVICE_NOT_CONFIGURED:
              setTranscriptionError("Transcription service is not available.");
              break;
            case TranscriptionErrorCode.NETWORK_ERROR:
              setTranscriptionError(
                "Network error. Please check your connection.",
              );
              break;
            default:
              // For retryable errors, show more helpful message
              setTranscriptionError(
                retryable ? "Transcription failed. Please try again." : message,
              );
          }
        } else {
          // Fallback for unexpected errors
          setTranscriptionError("Transcription failed. Please try again.");
        }
      } finally {
        setIsTranscribing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Clear transcription error after a delay
  useEffect(() => {
    if (transcriptionError) {
      const timer = setTimeout(() => {
        setTranscriptionError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [transcriptionError]);

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
    suggestions: autoSuggestions,
    onSelectSuggestion: handleSelectSuggestion,
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
  // We build a lightweight fingerprint instead of JSON.stringify to avoid
  // serializing large base64 attachment data on every render. The key captures:
  //   - message id, role, content length (text streaming)
  //   - content part count (multimodal additions)
  //   - tool call ids + argument lengths (tool call streaming)
  const messagesMemoKey = agent.messages
    .map((m) => {
      const contentKey =
        typeof m.content === "string"
          ? m.content.length
          : Array.isArray(m.content)
            ? m.content.length
            : 0;
      const toolCallsKey =
        "toolCalls" in m && Array.isArray(m.toolCalls)
          ? m.toolCalls
              .map(
                (tc: any) => `${tc.id}:${tc.function?.arguments?.length ?? 0}`,
              )
              .join(";")
          : "";
      return `${m.id}:${m.role}:${contentKey}:${toolCallsKey}`;
    })
    .join(",");
  const messages = useMemo(
    () => [...agent.messages],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messagesMemoKey],
  );

  // Compute the ID of the last user message for scroll-pinning logic.
  const lastUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return messages[i].id;
    }
    return null;
  }, [messages]);

  // Track a nonce that increments each time a new user message ID appears.
  // Using useState ensures the context value propagates correctly on the
  // render that follows the state update (approach b from the design doc).
  const [sendNonce, setSendNonce] = useState(0);
  // Seed with the current value so restoring a thread with existing messages
  // does not count as a new send. Only later-render id transitions bump.
  const prevLastUserMessageIdRef = useRef<string | null>(lastUserMessageId);

  useEffect(() => {
    if (
      lastUserMessageId &&
      lastUserMessageId !== prevLastUserMessageIdRef.current
    ) {
      setSendNonce((n) => n + 1);
      prevLastUserMessageIdRef.current = lastUserMessageId;
    }
  }, [lastUserMessageId]);

  const lastUserMessageState = useMemo<LastUserMessageState>(
    () => ({ id: lastUserMessageId, sendNonce }),
    [lastUserMessageId, sendNonce],
  );

  const finalProps: CopilotChatViewProps = {
    ...mergedProps,
    messages,
    // Input behavior props
    onSubmitMessage: onSubmitInput,
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
    onDrop: handleDrop,
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
        {attachmentsEnabled && (
          <input
            type="file"
            multiple
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept={attachmentsConfig?.accept ?? "*/*"}
            style={{ display: "none" }}
          />
        )}
        {!isChatLicensed && <InlineFeatureWarning featureName="Chat" />}
        {transcriptionError && (
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
            {transcriptionError}
          </div>
        )}
        <LastUserMessageContext.Provider value={lastUserMessageState}>
          {RenderedChatView}
        </LastUserMessageContext.Provider>
      </div>
    </CopilotChatConfigurationProvider>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotChat {
  export const View = CopilotChatView;
}
