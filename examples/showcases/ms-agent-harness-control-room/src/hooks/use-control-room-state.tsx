"use client";

/**
 * Local cockpit UI state + a thin helper for reading the live Harness agent
 * state.
 *
 * State is split between two surfaces:
 *
 *  1. **Local UI state** (this file's React Context) — the currently selected
 *     endpoint, the connection-status indicator, the last connection error,
 *     and a reconnect counter that children can bump. None of this is
 *     replicated to the agent — it's pure UI.
 *
 *  2. **Live agent state** — owned by the Microsoft Agent Harness providers
 *     (Todo, AgentMode, FileMemory, etc.) and exposed via v2's `useAgent` hook
 *     which subscribes to `state` change notifications from `@ag-ui/client`'s
 *     `AbstractAgent`. We re-export a thin helper `useControlRoomAgentState`
 *     so panels don't need to wire `UseAgentUpdate.OnStateChanged` each time.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import {
  useAgent,
  useCopilotKit,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";

import type {
  ControlRoomFeatureSupport,
  ControlRoomStateSnapshot,
} from "@/lib/control-room-types";
import { parseFixtureDiagnosis } from "@/lib/fixture-diagnosis-schema";

/** Agent name registered on the Harness backend (Program.cs / ControlRoomAgent.cs). */
export const CONTROL_ROOM_AGENT_NAME = "control_room_agent";

/** Default snapshot shown before the agent has emitted any state. */
export const CONTROL_ROOM_INITIAL_STATE: ControlRoomStateSnapshot = {
  mode: "Plan",
  todos: [],
  memory: [],
  observers: null,
  features: null,
};

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export interface ControlRoomLocalState {
  currentEndpoint: string;
  featureSupport: ControlRoomFeatureSupport | null;
  connectionStatus: ConnectionStatus;
  lastError?: string;
  reconnectAttempts: number;
}

export interface ControlRoomLocalContextValue {
  localState: ControlRoomLocalState;
  /** Update the active endpoint. Caller must have validated the URL. */
  setEndpoint: (url: string) => void;
  /** Cache the agent's reported feature support payload. */
  setFeatureSupport: (support: ControlRoomFeatureSupport | null) => void;
  /** Record the most recent connection probe result. */
  recordConnection: (status: ConnectionStatus, error?: string) => void;
  /** Increment the reconnect counter (children watch this to refetch). */
  bumpReconnect: () => void;
}

const ControlRoomLocalContext =
  createContext<ControlRoomLocalContextValue | null>(null);

interface ControlRoomProviderProps {
  children: ReactNode;
  currentEndpoint: string;
  setCurrentEndpoint: (url: string) => void;
}

export function ControlRoomProvider({
  children,
  currentEndpoint,
  setCurrentEndpoint,
}: ControlRoomProviderProps) {
  const [featureSupport, setFeatureSupportState] =
    useState<ControlRoomFeatureSupport | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [lastError, setLastError] = useState<string | undefined>(undefined);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const setEndpoint = useCallback(
    (url: string) => {
      setCurrentEndpoint(url);
      setConnectionStatus("idle");
      setLastError(undefined);
      setFeatureSupportState(null);
    },
    [setCurrentEndpoint],
  );

  const setFeatureSupport = useCallback(
    (support: ControlRoomFeatureSupport | null) => {
      setFeatureSupportState(support);
    },
    [],
  );

  const recordConnection = useCallback(
    (status: ConnectionStatus, error?: string) => {
      setConnectionStatus(status);
      setLastError(error);
    },
    [],
  );

  const bumpReconnect = useCallback(() => {
    setReconnectAttempts((n) => n + 1);
  }, []);

  const value = useMemo<ControlRoomLocalContextValue>(
    () => ({
      localState: {
        currentEndpoint,
        featureSupport,
        connectionStatus,
        lastError,
        reconnectAttempts,
      },
      setEndpoint,
      setFeatureSupport,
      recordConnection,
      bumpReconnect,
    }),
    [
      currentEndpoint,
      featureSupport,
      connectionStatus,
      lastError,
      reconnectAttempts,
      setEndpoint,
      setFeatureSupport,
      recordConnection,
      bumpReconnect,
    ],
  );

  return (
    <ControlRoomLocalContext.Provider value={value}>
      {children}
    </ControlRoomLocalContext.Provider>
  );
}

/**
 * Read the local cockpit UI state (endpoint, connection probe, reconnect
 * counter). Throws when used outside <ControlRoomProvider>.
 */
export function useControlRoomLocal(): ControlRoomLocalContextValue {
  const value = useContext(ControlRoomLocalContext);
  if (!value) {
    throw new Error(
      "useControlRoomLocal must be used inside a <ControlRoomProvider>.",
    );
  }
  return value;
}

/**
 * Subscribe to live Harness agent state. Re-renders on every message and
 * state notification from the AG-UI client, then derives the inspector
 * snapshot by scanning the agent's tool-call message history.
 *
 * Harness's `TodoListProvider`, `AgentModeProvider`, `FileMemoryProvider` etc.
 * emit their data as tool calls rather than pushing into `agent.state`, so the
 * inspectors reconstruct the current Mode / Todos / Memory / Repo & Test
 * observer values from the latest assistant tool call + matching tool result.
 */
export function useControlRoomAgentState(): ControlRoomStateSnapshot {
  const { agent } = useAgent({
    agentId: CONTROL_ROOM_AGENT_NAME,
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnMessagesChanged],
  });
  return useMemo(
    () => deriveAgentSnapshot(agent.messages, agent.state),
    [agent.messages, agent.state],
  );
}

interface ToolCallSnapshot {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
}

function deriveAgentSnapshot(
  messages: ReadonlyArray<unknown> | undefined,
  rawState: unknown,
): ControlRoomStateSnapshot {
  const msgArray = messages ?? [];
  const calls = collectToolCalls(msgArray);
  const mode = deriveMode(calls);
  const todos = deriveTodos(calls);
  const memory = deriveMemory(calls);
  const skills = deriveSkills(calls);
  const observers = deriveObservers(calls);
  const structuredDiagnosis = deriveStructuredDiagnosis(msgArray);

  const base: ControlRoomStateSnapshot = {
    ...CONTROL_ROOM_INITIAL_STATE,
    mode,
    todos,
    memory,
    skills,
    structuredDiagnosis,
    observers,
  };

  // If the agent ever does push to `state` (future native AG-UI support),
  // let it override the derived view.
  if (rawState && typeof rawState === "object") {
    return { ...base, ...(rawState as Partial<ControlRoomStateSnapshot>) };
  }
  return base;
}

function collectToolCalls(
  messages: ReadonlyArray<unknown>,
): ToolCallSnapshot[] {
  const calls: ToolCallSnapshot[] = [];
  const resultsByCallId = new Map<string, string>();
  for (const raw of messages) {
    const m = raw as { role?: string; toolCallId?: string; content?: string };
    if (m?.role === "tool" && typeof m.toolCallId === "string") {
      resultsByCallId.set(m.toolCallId, m.content ?? "");
    }
  }
  for (const raw of messages) {
    const m = raw as {
      role?: string;
      toolCalls?: {
        id: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    if (m?.role !== "assistant" || !Array.isArray(m.toolCalls)) continue;
    for (const tc of m.toolCalls) {
      const name = tc.function?.name;
      if (!name || !tc.id) continue;
      let args: Record<string, unknown> = {};
      const rawArgs = tc.function?.arguments;
      if (typeof rawArgs === "string" && rawArgs.length > 0) {
        try {
          args = JSON.parse(rawArgs);
        } catch {
          args = {};
        }
      }
      calls.push({
        callId: tc.id,
        name,
        args,
        result: resultsByCallId.get(tc.id),
      });
    }
  }
  return calls;
}

function deriveMode(
  calls: ToolCallSnapshot[],
): ControlRoomStateSnapshot["mode"] {
  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const c = calls[i];
    if (c.name === "AgentMode_Set" && typeof c.args.mode === "string") {
      return normalizeMode(c.args.mode);
    }
    if (c.name === "AgentMode_Get" && c.result) {
      return normalizeMode(c.result);
    }
  }
  return "Plan";
}

function normalizeMode(raw: string): ControlRoomStateSnapshot["mode"] {
  const v = raw.replace(/^"|"$/g, "").trim().toLowerCase();
  if (v.startsWith("act") || v.startsWith("execut")) return "Act";
  if (v.startsWith("review")) return "Review";
  return "Plan";
}

interface HarnessTodo {
  id: number | string;
  title?: string;
  description?: string;
  isComplete?: boolean;
}

function deriveTodos(
  calls: ToolCallSnapshot[],
): ControlRoomStateSnapshot["todos"] {
  // Find the latest TodoList_Add result — its return payload is the canonical
  // todo list. Subsequent TodoList_Complete calls flip individual items.
  let latest: HarnessTodo[] | null = null;
  const completed = new Set<string>();
  for (const call of calls) {
    if (call.name === "TodoList_Add" && call.result) {
      const parsed = safeJsonParse(call.result);
      if (Array.isArray(parsed)) {
        latest = parsed as HarnessTodo[];
        completed.clear();
      }
    } else if (
      call.name === "TodoList_Complete" &&
      Array.isArray(call.args.items)
    ) {
      for (const item of call.args.items as { id?: number | string }[]) {
        if (item?.id != null) completed.add(String(item.id));
      }
    }
  }
  if (!latest) return [];
  return latest.map((t) => ({
    id: String(t.id ?? ""),
    label: t.title?.trim() ? t.title : (t.description ?? "(untitled)"),
    status:
      completed.has(String(t.id)) || t.isComplete ? "completed" : "pending",
  }));
}

function deriveMemory(
  calls: ToolCallSnapshot[],
): ControlRoomStateSnapshot["memory"] {
  const entries = new Map<string, string>();
  for (const call of calls) {
    if (call.name === "FileMemory_SaveFile") {
      const fileName = call.args.fileName;
      const description = call.args.description;
      if (typeof fileName === "string") {
        entries.set(
          fileName,
          typeof description === "string" ? description : "(saved)",
        );
      }
    }
    if (call.name === "FileMemory_DeleteFile") {
      const fileName = call.args.fileName;
      if (typeof fileName === "string") entries.delete(fileName);
    }
  }
  return [...entries.entries()].map(([key, value]) => ({ key, value }));
}

function deriveSkills(
  calls: ToolCallSnapshot[],
): ControlRoomStateSnapshot["skills"] {
  const skills = new Map<
    string,
    {
      lastActivity: "loaded" | "resource_read" | "script_run";
      lastDetail?: string;
      invocations: number;
    }
  >();
  const upsert = (
    name: string,
    activity: "loaded" | "resource_read" | "script_run",
    detail?: string,
  ) => {
    const prev = skills.get(name);
    skills.set(name, {
      lastActivity: activity,
      lastDetail: detail,
      invocations: (prev?.invocations ?? 0) + 1,
    });
  };
  for (const call of calls) {
    const name = call.args.skillName;
    if (typeof name !== "string" || name.length === 0) continue;
    if (call.name === "load_skill") {
      upsert(name, "loaded");
    } else if (call.name === "read_skill_resource") {
      const resource = call.args.resourceName;
      upsert(
        name,
        "resource_read",
        typeof resource === "string" ? resource : undefined,
      );
    } else if (call.name === "run_skill_script") {
      const script = call.args.scriptName;
      upsert(
        name,
        "script_run",
        typeof script === "string" ? script : undefined,
      );
    }
  }
  return [...skills.entries()].map(([name, info]) => ({
    name,
    lastActivity: info.lastActivity,
    lastDetail: info.lastDetail ?? null,
    invocations: info.invocations,
  }));
}

function deriveObservers(
  calls: ToolCallSnapshot[],
): ControlRoomStateSnapshot["observers"] {
  let repoFileCount = 0;
  let latestTestCommand: string | null = null;
  let latestTestSuccess: boolean | null = null;
  for (const call of calls) {
    if (call.name === "FileAccess_ListFiles" && call.result) {
      const parsed = safeJsonParse(call.result);
      if (Array.isArray(parsed)) repoFileCount = parsed.length;
    }
    if (call.name === "pnpm_run" && call.result) {
      const cmd = call.args.command;
      const parsed = safeJsonParse(call.result) as {
        command?: string;
        exitCode?: number;
      } | null;
      if (typeof cmd === "string") latestTestCommand = cmd;
      if (parsed && typeof parsed.exitCode === "number") {
        latestTestSuccess = parsed.exitCode === 0;
      }
    }
  }
  return {
    repo_file_count: repoFileCount,
    latest_test_command: latestTestCommand,
    latest_test_success: latestTestSuccess,
  };
}

function deriveStructuredDiagnosis(
  messages: ReadonlyArray<unknown>,
): ControlRoomStateSnapshot["structuredDiagnosis"] {
  // Walk back through assistant messages looking for the latest one whose
  // content parses as a `FixtureDiagnosis`. Tool-using turns produce
  // intermediate assistant messages without final text; only the terminal
  // assistant message carries the schema-constrained JSON.
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as { role?: string; id?: string; content?: string };
    if (
      m?.role !== "assistant" ||
      typeof m.content !== "string" ||
      m.content.trim().length === 0
    ) {
      continue;
    }
    const payload = parseFixtureDiagnosis(m.content);
    if (payload) {
      return { messageId: m.id ?? "", payload, raw: m.content };
    }
  }
  return null;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Send a user message to the Control Room agent and kick off a run. Mirrors
 * what `<CopilotChat>`'s submit handler does so left-pane controls can drive
 * the agent without the operator having to type into the chat.
 *
 * The optional `forwardedProps` are merged into AG-UI's per-run
 * `forwardedProps` channel — useful for per-turn directives like structured
 * output (`{ responseFormat: { type: "json_schema", json_schema: {...} } }`).
 * The agent-side glue lives in `agent/ForwardedPropsResponseFormatPromoter.cs`.
 */
export function useSendUserMessage(): {
  send: (
    content: string,
    options?: { forwardedProps?: Record<string, unknown> },
  ) => Promise<void>;
  isRunning: boolean;
} {
  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({
    agentId: CONTROL_ROOM_AGENT_NAME,
    updates: [UseAgentUpdate.OnRunStatusChanged],
  });
  const send = useCallback(
    async (
      content: string,
      options?: { forwardedProps?: Record<string, unknown> },
    ) => {
      if (!content.trim()) return;
      const a = agent as unknown as {
        addMessage: (m: { id: string; role: string; content: string }) => void;
        isRunning?: boolean;
      };
      if (a.isRunning) return;
      a.addMessage({
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        role: "user",
        content,
      });
      await (
        copilotkit as unknown as {
          runAgent: (args: {
            agent: unknown;
            forwardedProps?: Record<string, unknown>;
          }) => Promise<void>;
        }
      ).runAgent({ agent, forwardedProps: options?.forwardedProps });
    },
    [agent, copilotkit],
  );
  const isRunning =
    (agent as unknown as { isRunning?: boolean }).isRunning ?? false;
  return { send, isRunning };
}

/**
 * V1 back-compat shim used by older inspector components that imported
 * `useControlRoomState`. New code should call `useControlRoomLocal` (for UI
 * state) and `useControlRoomAgentState` (for agent state) directly.
 */
export function useControlRoomState() {
  const local = useControlRoomLocal();
  const agentState = useControlRoomAgentState();
  return {
    ...local,
    agentState,
  };
}
