"use client";

/**
 * Four fixed command IDs the fixture supports. Clicking a button asks the
 * agent — through a user-role chat message — to invoke its `pnpm_run` tool
 * with the matching argument. The agent owns the approval lifecycle so the
 * tool call still flows through Harness's normal gating; the buttons are
 * just a shortcut so operators don't have to type the request.
 */

import { useSendUserMessage } from "@/hooks/use-control-room-state";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <Card size="sm">
      <CardHeader>
        <CardTitle>Commands</CardTitle>
        <CardDescription>
          Shortcuts for approval-gated fixture commands.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          {COMMANDS.map((command) => (
            <Button
              key={command.id}
              type="button"
              title={`Ask the agent to run ${command.id} via pnpm_run.`}
              onClick={() => void send(command.prompt)}
              disabled={isRunning}
              variant="outline"
              size="sm"
            >
              {command.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {isRunning
            ? "Agent is busy. Request after the current run finishes."
            : "Requests are sent through chat and still use Harness approvals."}
        </p>
      </CardContent>
    </Card>
  );
}
