import { useState, useEffect } from "react";
import { useAgent } from "./use-agent";

/**
 * The current phase of the agent's streaming lifecycle.
 *
 * - `"idle"` — No active run (or run just started/ended, waiting for first event).
 * - `"reasoning"` — Agent is thinking / reasoning (e.g. chain-of-thought).
 * - `"tool_calling"` — Agent is invoking a tool. Check `toolName` for which one.
 * - `"streaming"` — Agent is streaming a text response to the user.
 */
export type StreamingPhase =
  | "idle"
  | "reasoning"
  | "tool_calling"
  | "streaming";

/**
 * Granular streaming status returned by {@link useStreamingStatus}.
 */
export interface StreamingStatus {
  /** Current phase of the agent run. */
  phase: StreamingPhase;
  /** Whether an agent run is currently active. */
  isRunning: boolean;
  /** Name of the tool currently being called, or `null` if not in a tool call. */
  toolName: string | null;
  /** ID of the current tool call, or `null`. */
  toolCallId: string | null;
}

export interface UseStreamingStatusProps {
  /** Optional agent ID. Defaults to the current configured chat agent. */
  agentId?: string;
}

const IDLE_STATUS: StreamingStatus = {
  phase: "idle",
  isRunning: false,
  toolName: null,
  toolCallId: null,
};

/**
 * Exposes the real-time streaming phase of the current agent run.
 *
 * While `useAgent()` only gives you `agent.isRunning` (a boolean),
 * this hook tells you *what* the agent is doing right now:
 * reasoning, calling a tool (and which one), or streaming text.
 *
 * @param props - Optional configuration.
 * @param props.agentId - The ID of the agent to observe. Defaults to the
 *   chat agent configured by the nearest `<CopilotKitProvider>`.
 *
 * @returns A {@link StreamingStatus} object with four fields:
 * - `phase` — Current {@link StreamingPhase}: `"idle"`, `"reasoning"`,
 *   `"tool_calling"`, or `"streaming"`.
 * - `isRunning` — `true` while an agent run is active.
 * - `toolName` — Name of the tool currently being invoked, or `null`.
 * - `toolCallId` — ID of the active tool call, or `null`.
 *
 * **Note:** Only the most recent tool call is tracked. If the agent invokes
 * multiple tools in parallel, `toolName` / `toolCallId` will reflect
 * whichever call started last and will be cleared when *any* call ends.
 *
 * @example
 * Simple status text indicator:
 * ```tsx
 * function StatusBadge() {
 *   const status = useStreamingStatus();
 *
 *   if (!status.isRunning) return null;
 *
 *   return (
 *     <span>
 *       {status.phase === "reasoning" && "Thinking..."}
 *       {status.phase === "tool_calling" && `Calling ${status.toolName}...`}
 *       {status.phase === "streaming" && "Writing response..."}
 *     </span>
 *   );
 * }
 * ```
 *
 * @example
 * Phase-specific progress UI with colors:
 * ```tsx
 * function PhaseIndicator() {
 *   const status = useStreamingStatus();
 *
 *   const colors: Record<string, string> = {
 *     reasoning: "#fef3c7",
 *     tool_calling: "#dbeafe",
 *     streaming: "#d1fae5",
 *   };
 *
 *   if (!status.isRunning) return null;
 *
 *   return (
 *     <div style={{ background: colors[status.phase] ?? "#f3f4f6" }}>
 *       {status.phase === "tool_calling"
 *         ? `Running tool: ${status.toolName}`
 *         : status.phase}
 *     </div>
 *   );
 * }
 * ```
 */
export function useStreamingStatus(
  props?: UseStreamingStatusProps,
): StreamingStatus {
  const { agent } = useAgent({ agentId: props?.agentId });
  const [status, setStatus] = useState<StreamingStatus>(IDLE_STATUS);

  useEffect(() => {
    const subscription = agent.subscribe({
      onRunInitialized: () => {
        setStatus({
          phase: "idle",
          isRunning: true,
          toolName: null,
          toolCallId: null,
        });
      },

      onReasoningStartEvent: () => {
        setStatus((prev) => ({ ...prev, phase: "reasoning" }));
      },
      onReasoningEndEvent: () => {
        setStatus((prev) =>
          prev.phase === "reasoning" ? { ...prev, phase: "idle" } : prev,
        );
      },

      onToolCallStartEvent: ({ event }) => {
        setStatus((prev) => ({
          ...prev,
          phase: "tool_calling",
          toolName: event.toolCallName,
          toolCallId: event.toolCallId,
        }));
      },
      onToolCallEndEvent: () => {
        setStatus((prev) =>
          prev.phase === "tool_calling"
            ? { ...prev, phase: "idle", toolName: null, toolCallId: null }
            : prev,
        );
      },

      onTextMessageStartEvent: () => {
        setStatus((prev) => ({ ...prev, phase: "streaming" }));
      },
      onTextMessageEndEvent: () => {
        setStatus((prev) =>
          prev.phase === "streaming" ? { ...prev, phase: "idle" } : prev,
        );
      },

      onRunFinalized: () => {
        setStatus(IDLE_STATUS);
      },
      onRunFailed: () => {
        setStatus(IDLE_STATUS);
      },
    });

    return () => subscription.unsubscribe();
  }, [agent]);

  return status;
}
