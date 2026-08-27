import type { ɵThread, ɵThreadStore } from "@copilotkit/core";
import type { ThreadDebuggerProvider } from "../../shared/thread-debugger/types.js";

export type ExampleKind = "realtime_sync" | "manage_history" | "inspect_runs";

export type ThreadsExampleOverviewVideoState =
  | "deferred"
  | "ready"
  | "playing"
  | "failed";

export type ThreadsSetupPromptCopyState = "idle" | "copied" | "error";

export type ThreadsExampleOverviewVideoListeners = Readonly<{
  loadeddata: EventListener;
  play: EventListener;
  pause: EventListener;
  error: EventListener;
}>;

export interface ThreadsState {
  selectedThreadId: string | null;
  inAppThreadId: string | null;
  inAppAgentId: string | null;
  inAppSource: "app" | "override" | null;
  activeViewInAppRequestId: string | null;
  viewInAppError: string | null;
  inspectorBridgeUnsubscribers: Array<() => void>;
  selectedRealThreadIsExplicit: boolean;
  selectedLocalExampleThreadId: string | null;
  requestedThreadId: string | null;
  focusedThreadMessageId: string | null;
  threadFocusRequestId: number;
  threadListWidth: number;
  threadDividerResizing: boolean;
  threadDividerPointerId: number;
  threadDividerStartX: number;
  threadDividerStartWidth: number;
  threads: ɵThread[];
  threadStoreSubscriptions: Map<string, () => void>;
  threadsByAgent: Map<string, ɵThread[]>;
  threadUsageSignature: string;
  threadUsageRefreshTimer: ReturnType<typeof setTimeout> | null;
  threadsErrorByAgent: Map<string, Error>;
  threadsLoadingByAgent: Map<string, boolean>;
  ownedThreadStores: Map<string, ɵThreadStore>;
  threadCapabilityEnabled: boolean | null;
  threadCapabilityGeneration: number;
  threadRefreshLastSentAt: Map<string, number>;
  threadRefreshTrailingTimers: Map<string, ReturnType<typeof setTimeout>>;
  viewedThreadsTelemetryStates: Set<string>;
  viewedExampleKinds: Set<ExampleKind>;
  selectedExampleKinds: Set<ExampleKind>;
  viewedExampleTourSteps: Set<string>;
  exampleThreadProviders: Map<string, ThreadDebuggerProvider>;
  exampleTourDismissed: boolean;
  exampleTourActive: boolean;
  exampleTourStep: number;
  exampleTourAutoShown: boolean;
  exampleOverviewVideoState: ThreadsExampleOverviewVideoState;
  exampleOverviewVideoLoaded: boolean;
  exampleOverviewVideoReducedMotion: boolean;
  exampleOverviewVideoLoadTimer: number | null;
  exampleOverviewVideoIdleCallbackId: number | null;
  exampleOverviewVideoElement: HTMLVideoElement | null;
  exampleOverviewVideoListeners: ThreadsExampleOverviewVideoListeners | null;
  exampleOverviewVideoLifecycleGeneration: number;
  exampleOverviewVideoPlayAttemptGeneration: number;
  exampleOverviewVideoPlayPromise: Promise<void> | null;
  exampleOverviewVideoPlayOnNextBind: boolean;
  setupPromptCopyState: ThreadsSetupPromptCopyState;
  setupPromptCopyResetTimeoutId: number | null;
  setupPromptCopyGeneration: number;
}

export function createThreadsState(): ThreadsState {
  return {
    selectedThreadId: null,
    inAppThreadId: null,
    inAppAgentId: null,
    inAppSource: null,
    activeViewInAppRequestId: null,
    viewInAppError: null,
    inspectorBridgeUnsubscribers: [],
    selectedRealThreadIsExplicit: false,
    selectedLocalExampleThreadId: null,
    requestedThreadId: null,
    focusedThreadMessageId: null,
    threadFocusRequestId: 0,
    threadListWidth: 290,
    threadDividerResizing: false,
    threadDividerPointerId: -1,
    threadDividerStartX: 0,
    threadDividerStartWidth: 0,
    threads: [],
    threadStoreSubscriptions: new Map(),
    threadsByAgent: new Map(),
    threadUsageSignature: "",
    threadUsageRefreshTimer: null,
    threadsErrorByAgent: new Map(),
    threadsLoadingByAgent: new Map(),
    ownedThreadStores: new Map(),
    threadCapabilityEnabled: null,
    threadCapabilityGeneration: 0,
    threadRefreshLastSentAt: new Map(),
    threadRefreshTrailingTimers: new Map(),
    viewedThreadsTelemetryStates: new Set(),
    viewedExampleKinds: new Set(),
    selectedExampleKinds: new Set(),
    viewedExampleTourSteps: new Set(),
    exampleThreadProviders: new Map(),
    exampleTourDismissed: false,
    exampleTourActive: false,
    exampleTourStep: 0,
    exampleTourAutoShown: false,
    exampleOverviewVideoState: "deferred",
    exampleOverviewVideoLoaded: false,
    exampleOverviewVideoReducedMotion: false,
    exampleOverviewVideoLoadTimer: null,
    exampleOverviewVideoIdleCallbackId: null,
    exampleOverviewVideoElement: null,
    exampleOverviewVideoListeners: null,
    exampleOverviewVideoLifecycleGeneration: 0,
    exampleOverviewVideoPlayAttemptGeneration: 0,
    exampleOverviewVideoPlayPromise: null,
    exampleOverviewVideoPlayOnNextBind: false,
    setupPromptCopyState: "idle",
    setupPromptCopyResetTimeoutId: null,
    setupPromptCopyGeneration: 0,
  };
}
