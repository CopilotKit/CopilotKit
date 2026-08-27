import type { AbstractAgent } from "@ag-ui/client";
import type { DisplayValue } from "../../shared/display/types.js";

export interface PlaygroundToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: DisplayValue | string;
  };
  toolName?: string;
  arguments?: DisplayValue | string;
  status?: string;
}

export interface PlaygroundMessage {
  id?: string;
  role: string;
  contentText: string;
  contentRaw?: DisplayValue;
  toolCalls: PlaygroundToolCall[];
  toolCallId?: string;
  activityType?: string;
}

export interface PlaygroundState {
  agent: AbstractAgent | null;
  agentId: string | null;
  agentUnsubscribe: (() => void) | null;
  messages: PlaygroundMessage[];
  input: string;
  isRunning: boolean;
  runStartedAt: number | null;
  reasoningDurations: Map<string, number>;
  isLoadingThread: boolean;
  error: string | null;
  sourceThreadId: string | null;
  showEphemeralNotice: boolean;
  sessionGeneration: number;
  loadGeneration: number;
  runGeneration: number;
}

export function createPlaygroundState(): PlaygroundState {
  return {
    agent: null,
    agentId: null,
    agentUnsubscribe: null,
    messages: [],
    input: "",
    isRunning: false,
    runStartedAt: null,
    reasoningDurations: new Map(),
    isLoadingThread: false,
    error: null,
    sourceThreadId: null,
    showEphemeralNotice: false,
    sessionGeneration: 0,
    loadGeneration: 0,
    runGeneration: 0,
  };
}
