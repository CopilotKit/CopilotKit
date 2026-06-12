"use client";

/**
 * Plan / Act / Review mode toggle.
 *
 * The displayed value is derived from the latest `AgentMode_Set` /
 * `AgentMode_Get` tool call. Clicking a mode sends a user chat message
 * asking the agent to switch — the agent owns the `AgentMode_Set` call and
 * the underlying `AgentModeProvider` is the source of truth.
 */

import {
  useControlRoomAgentState,
  useSendUserMessage,
} from "@/hooks/use-control-room-state";
import type { ControlRoomMode } from "@/lib/control-room-types";

const MODES: ControlRoomMode[] = ["Plan", "Act", "Review"];

const PROMPT: Record<ControlRoomMode, string> = {
  Plan: "Please switch to plan mode.",
  Act: "Please switch to execute (act) mode and continue.",
  Review: "Please switch to review mode for handoff.",
};

export function ModeControls() {
  const agentState = useControlRoomAgentState();
  const { send, isRunning } = useSendUserMessage();
  const current = agentState.mode;

  const handleSelect = (mode: ControlRoomMode) => {
    if (mode === current || isRunning) return;
    void send(PROMPT[mode]);
  };

  return (
    <div>
      <h3 className="cr-heading mb-2">Mode</h3>
      <div
        role="radiogroup"
        aria-label="Control room mode"
        className="cr-mode-toggle"
      >
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={mode === current}
            onClick={() => handleSelect(mode)}
            disabled={isRunning}
            data-active={mode === current ? "true" : undefined}
          >
            {mode}
          </button>
        ))}
      </div>
      <p
        className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
        style={{ fontFamily: "var(--cr-font-mono)" }}
      >
        {isRunning
          ? "Agent busy · mode change after current run"
          : "Click to ask the agent to switch modes"}
      </p>
    </div>
  );
}
