"use client";

import { useEffect, useState } from "react";
import {
  UseAgentUpdate,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import { AGENT_ID } from "@/agent";

/** The parts of the canvas surface that this hook reads. */
interface RepairableSurface {
  status: string;
  /** Operations the runtime rejected in the last render. */
  serverRejected: readonly unknown[];
}

/** Settle runs allowed per user message: the first result, then two fixes. */
const MAX_SETTLES_PER_TURN = 3;

/**
 * Hands each `render_ui` result back to the agent as soon as the run ends.
 *
 * On Antigravity a turn pauses when the agent calls `render_ui`, and the
 * result (what the runtime drew, and any operations it rejected for a wrong
 * prop) only reaches the model with the next run. This starts that run at
 * once, with no new message:
 *
 * - If some operations were rejected, the model sends them again, fixed.
 * - If not, the model ends its turn, so the next user message starts a fresh
 *   one. Sending the next message into a paused turn instead stalls
 *   ag-ui-antigravity 0.2.1: the run never ends.
 *
 * Returns true while rejected operations are waiting for their fix, so the
 * caller can hold off storing a version of a half-drawn canvas.
 */
export function useCanvasRepair(surface: RepairableSurface | undefined) {
  const { agent } = useAgent({
    agentId: AGENT_ID,
    updates: [
      UseAgentUpdate.OnRunStatusChanged,
      UseAgentUpdate.OnMessagesChanged,
    ],
  });
  const { copilotkit } = useCopilotKit();
  // Tool call ids whose result was already handed back.
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  // Settle runs per user message, keyed by the number of user messages.
  const [counts, setCounts] = useState<Readonly<Record<number, number>>>({});
  // From the moment a settle run is asked for until it is over. The agent's
  // own running flag turns on a moment later, which would leave a gap.
  const [inFlight, setInFlight] = useState(false);

  const messages = agent.messages;
  const turn = messages.filter((m) => m.role === "user").length;
  const last = messages.at(-1);
  const pendingResult =
    last?.role === "tool" && !settled.has(last.toolCallId)
      ? last.toolCallId
      : undefined;
  const allowed = (counts[turn] ?? 0) < MAX_SETTLES_PER_TURN;
  const running = agent.isRunning;

  useEffect(() => {
    if (!pendingResult || !allowed || running || inFlight) return;
    setSettled((previous) => new Set(previous).add(pendingResult));
    setCounts((previous) => ({
      ...previous,
      [turn]: (previous[turn] ?? 0) + 1,
    }));
    setInFlight(true);
    copilotkit
      .runAgent({ agent })
      .catch((error: unknown) => {
        console.error("[canvas] Handing back the render result failed", error);
      })
      .finally(() => setInFlight(false));
  }, [pendingResult, allowed, running, inFlight, agent, copilotkit, turn]);

  const rejected =
    surface?.status === "ready" && surface.serverRejected.length > 0;
  // The surface turns "ready" when the render_ui call ends, a moment before
  // its result arrives and the run ends, so a running render counts too.
  return (
    rejected && (running || (Boolean(pendingResult) && allowed) || inFlight)
  );
}
