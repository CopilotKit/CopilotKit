"use client";

/**
 * Four fixed command IDs the fixture supports. Clicking a button asks the
 * agent — through a user-role chat message — to invoke its `pnpm_run` tool
 * with the matching argument. The agent owns the approval lifecycle so the
 * tool call still flows through Harness's normal gating; the buttons are
 * just a shortcut so operators don't have to type the request.
 */

import { useSendUserMessage } from "@/hooks/use-control-room-state";

const COMMANDS = [
  {
    id: "install",
    label: "install",
    prompt: 'Please run `pnpm_run` with command "install" in the fixture repo.',
  },
  {
    id: "test",
    label: "test",
    prompt: 'Please run `pnpm_run` with command "test" in the fixture repo.',
  },
  {
    id: "test:coverage",
    label: "test:coverage",
    prompt:
      'Please run `pnpm_run` with command "test:coverage" in the fixture repo.',
  },
  {
    id: "typecheck",
    label: "typecheck",
    prompt:
      'Please run `pnpm_run` with command "typecheck" in the fixture repo.',
  },
] as const;

export function CommandControls() {
  const { send, isRunning } = useSendUserMessage();

  return (
    <div>
      <h3 className="cr-heading mb-2">Commands</h3>
      <div className="grid grid-cols-2 gap-1.5">
        {COMMANDS.map((command) => (
          <button
            key={command.id}
            type="button"
            title={`Ask the agent to run ${command.id} via pnpm_run.`}
            onClick={() => void send(command.prompt)}
            disabled={isRunning}
            className="cr-btn"
            data-variant="ghost"
          >
            {command.label}
          </button>
        ))}
      </div>
      <p
        className="mt-2 text-[10px] uppercase leading-snug tracking-[0.18em] text-[var(--cr-muted)]"
        style={{ fontFamily: "var(--cr-font-mono)" }}
      >
        {isRunning
          ? "Agent busy · queue after current run"
          : "Approval-gated · request via chat"}
      </p>
    </div>
  );
}
