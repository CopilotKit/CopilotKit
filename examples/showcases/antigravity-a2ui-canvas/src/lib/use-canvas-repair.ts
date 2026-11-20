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

/**
 * Hand-back runs per user message: the first result, then two fixes. A
 * hand-back that fails counts too, so retries stay within the same bound.
 */
const MAX_SETTLES_PER_TURN = 3;

/** Pause before trying a failed hand-back again. */
const RETRY_DELAY_MS = 1500;

/**
 * Hands each `render_ui` result back to the agent as soon as the run ends.
 *
 * The result (what the runtime drew, and any operations it rejected for a
 * wrong prop) only reaches the model with the next run. This starts that run
 * at once, with no new message, so a rejected operation is fixed right away
 * instead of on the user's next message. On Antigravity, where the turn pauses
 * at `render_ui`, the model then fixes what was rejected or ends its turn. On
 * Express the agent answers a clean result with an empty run.
 *
 * A hand-back counts as delivered only once its run reaches RUN_FINISHED:
 * `runAgent` also resolves when the request fails. An undelivered result is
 * tried again until the turn's runs are spent. A result still undelivered
 * after that goes to the agent with the user's next message, which
 * ag-ui-antigravity accepts: it answers the paused call and adds the message
 * to the same turn.
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
  // Tool call ids whose result reached the agent.
  const [delivered, setDelivered] = useState<ReadonlySet<string>>(new Set());
  // Hand-back runs started per user message, keyed by the number of user
  // messages.
  const [attempts, setAttempts] = useState<Readonly<Record<number, number>>>(
    {},
  );
  // From the moment a hand-back is asked for until it is over (and, after a
  // failure, the retry delay). The agent's own running flag turns on a moment
  // later, which would leave a gap.
  const [inFlight, setInFlight] = useState(false);

  const messages = agent.messages;
  const turn = messages.filter((m) => m.role === "user").length;
  const last = messages.at(-1);
  const pendingResult =
    last?.role === "tool" && !delivered.has(last.toolCallId)
      ? last.toolCallId
      : undefined;
  const allowed = (attempts[turn] ?? 0) < MAX_SETTLES_PER_TURN;
  const running = agent.isRunning;

  useEffect(() => {
    if (!pendingResult || !allowed || running || inFlight) return;
    setAttempts((previous) => ({
      ...previous,
      [turn]: (previous[turn] ?? 0) + 1,
    }));
    setInFlight(true);
    let finished = false;
    const { unsubscribe } = agent.subscribe({
      onRunFinishedEvent: () => {
        finished = true;
      },
    });
    copilotkit
      .runAgent({ agent })
      .catch((error: unknown) => {
        console.error("[canvas] Handing back the render result failed", error);
      })
      .finally(() => {
        unsubscribe();
        if (finished) {
          setDelivered((previous) => new Set(previous).add(pendingResult));
          setInFlight(false);
        } else {
          console.warn("[canvas] The render result did not reach the agent");
          setTimeout(() => setInFlight(false), RETRY_DELAY_MS);
        }
      });
  }, [pendingResult, allowed, running, inFlight, agent, copilotkit, turn]);

  const rejected =
    surface?.status === "ready" && surface.serverRejected.length > 0;
  // The surface turns "ready" when the render_ui call ends, a moment before
  // its result arrives and the run ends, so a running render counts too.
  return (
    rejected && (running || (Boolean(pendingResult) && allowed) || inFlight)
  );
}
