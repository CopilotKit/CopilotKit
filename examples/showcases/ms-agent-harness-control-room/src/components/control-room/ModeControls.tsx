"use client";

/**
 * Plan / Act mode toggle.
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const MODES: ControlRoomMode[] = ["Plan", "Act"];

const PROMPT: Record<ControlRoomMode, string> = {
  Plan: "Please switch to plan mode.",
  Act: "Please switch to execute (act) mode and continue.",
  Review: "Please save the review handoff to memory.",
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
    <Card size="sm">
      <CardHeader>
        <CardTitle>Mode</CardTitle>
        <CardDescription>
          Ask the Harness agent to plan or execute.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div
          role="radiogroup"
          aria-label="Control room mode"
          className="flex gap-2 rounded-2xl border bg-muted/50 p-1"
        >
          {MODES.map((mode) => (
            <Button
              key={mode}
              type="button"
              role="radio"
              aria-checked={mode === current}
              onClick={() => handleSelect(mode)}
              disabled={isRunning}
              variant={mode === current ? "default" : "ghost"}
              size="sm"
              className="flex-1"
            >
              {mode}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {isRunning
            ? "Agent is busy. Change mode after the current run."
            : "The agent owns the AgentModeProvider state."}
        </p>
      </CardContent>
    </Card>
  );
}
