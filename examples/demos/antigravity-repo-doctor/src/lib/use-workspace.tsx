"use client";

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import { AGENT_ID } from "./agent-id";
import { parseAgentState } from "./agent-state";
import type { AgentState } from "./agent-state";

interface ToolCallLike {
  id: string;
  function?: { name?: string };
}

interface MessageLike {
  role: string;
  toolCalls?: ToolCallLike[];
  toolCallId?: string;
}

export interface Workspace {
  state: AgentState;
  /** A run_tests call has started and has no result yet. */
  testsRunning: boolean;
  /** A run_check call has started and has no result yet. */
  checkRunning: boolean;
  /** The thread's messages, for the downloadable report. */
  messages: readonly unknown[];
  /** A run is in progress. */
  running: boolean;
}

const WorkspaceContext = createContext<Workspace | null>(null);

/**
 * Subscribes to the agent once and shares the parsed state. Every tool card
 * reads it, so a per-card subscription would rescan all messages per card on
 * every streamed event.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { agent } = useAgent({ agentId: AGENT_ID });
  const state = useMemo(() => parseAgentState(agent.state), [agent.state]);
  const messages = agent.messages as MessageLike[];

  const pending = useMemo(() => {
    const answered = new Set(
      messages
        .filter((m) => m.role === "tool" && m.toolCallId)
        .map((m) => m.toolCallId),
    );
    const open = (name: string) =>
      messages.some((m) =>
        (m.toolCalls ?? []).some(
          (c) => c.function?.name === name && !answered.has(c.id),
        ),
      );
    return { tests: open("run_tests"), check: open("run_check") };
  }, [messages]);

  const value = useMemo(
    () => ({
      state,
      testsRunning: agent.isRunning && pending.tests,
      checkRunning: agent.isRunning && pending.check,
      messages,
      running: agent.isRunning,
    }),
    [state, agent.isRunning, pending, messages],
  );
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace)
    throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return workspace;
}

/** A workspace path shown relative to the repository root. */
export function relativeToRepo(
  path: string | undefined,
  repoPath: string | undefined,
): string {
  if (!path) return "";
  path = path.replace(/^file:\/\//, "");
  if (!repoPath) return path;
  // The harness may report resolved paths (/private/tmp on macOS); cut at the
  // workspace folder name, which is unique per thread.
  const folder = repoPath.split("/").filter(Boolean).at(-1);
  if (!folder) return path;
  const marker = `/${folder}`;
  const index = path.indexOf(marker);
  if (index === -1) return path;
  const rest = path.slice(index + marker.length).replace(/^\//, "");
  return rest || ".";
}
