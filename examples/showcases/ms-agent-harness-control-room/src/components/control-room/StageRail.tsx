"use client";

import {
  CheckCircle2,
  ClipboardList,
  FileSearch,
  FlaskConical,
  RotateCcw,
  Settings,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";

import { CommandControls } from "@/components/control-room/CommandControls";
import { ConnectionStatus } from "@/components/control-room/ConnectionStatus";
import { EndpointSelector } from "@/components/control-room/EndpointSelector";
import { FeatureAutodetectPanel } from "@/components/control-room/inspectors/ObserverPanels";
import { SkillsPanel } from "@/components/control-room/inspectors/SkillsPanel";
import { StructuredDiagnosisPanel } from "@/components/control-room/inspectors/StructuredDiagnosisPanel";
import { ModeControls } from "@/components/control-room/ModeControls";
import { StructuredOutputControl } from "@/components/control-room/StructuredOutputControl";
import { topRailButtonClass } from "@/components/control-room/top-rail-button";
import {
  useControlRoomAgentState,
  useControlRoomLocal,
  useSendUserMessage,
} from "@/hooks/use-control-room-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FixtureResetResult } from "@/lib/control-room-types";
import { CONTROL_ROOM_ENDPOINT_HEADER } from "@/lib/endpoint";
import { cn } from "@/lib/utils";

const GENERATIVE_UI_PROMPT_GUIDE =
  "If the matching generative UI component tool is available, render it in chat using realistic demo data. Do not mention unavailable component tools.";

const STAGE_STEPS = [
  {
    id: "plan",
    title: "Plan",
    eyebrow: "Skills + mode + todos",
    body: "Load the diagnosis skill, publish the checklist, and show a summary card.",
    icon: ClipboardList,
    prompt:
      `Load the "fixture-diagnosis" skill, switch to Plan mode, and create a concise todo list for fixing the seeded failing test. The fixture files are top-level \`calculator.ts\` and \`calculator.test.ts\`; do not refer to any \`src/\` path. Do not edit files or run commands yet. ${GENERATIVE_UI_PROMPT_GUIDE} Prefer showHarnessSummary with metrics for mode, todos, files, approvals, tests, and memory.`,
  },
  {
    id: "inspect",
    title: "Inspect",
    eyebrow: "File access",
    body: "Read fixture files and visualize file impact for the audience.",
    icon: FileSearch,
    prompt:
      `Inspect the fixture repository by listing files and reading the top-level files \`calculator.ts\` and \`calculator.test.ts\`. Do not use or mention any \`src/\` path. Identify the bug in one sentence. Do not edit files or run commands. ${GENERATIVE_UI_PROMPT_GUIDE} Prefer showFileImpactMap after reading the files, with calculator.ts as the risky implementation file and calculator.test.ts as the test evidence file.`,
  },
  {
    id: "fix",
    title: "Fix",
    eyebrow: "Patch with HITL",
    body: "Apply the smallest patch and refresh the Harness summary.",
    icon: Wrench,
    prompt:
      `Switch to Act mode and apply the minimal file change to top-level \`calculator.ts\` that fixes the calculator bug. Do not use any \`src/\` path. If Harness asks for approval, wait for the operator. Do not run pnpm_run yet. ${GENERATIVE_UI_PROMPT_GUIDE} Prefer showHarnessSummary after the patch with metrics for mode, patched files, approvals, and next test command.`,
  },
  {
    id: "run",
    title: "Approve + Run",
    eyebrow: "Shell tool",
    body: "Show approval readiness, then run tests and chart progress.",
    icon: ShieldCheck,
    prompt:
      `Before running tests, use showApprovalReadinessForm if available to show the command, risk, and readiness checks. Then run \`pnpm_run\` with command "test" in the fixture repo. If dependencies are missing, immediately run \`pnpm_run\` with command "install" and then rerun \`pnpm_run\` with command "test"; do not stop to ask first. ${GENERATIVE_UI_PROMPT_GUIDE} Prefer showRepairTrendChart after the test result with stages Plan, Inspect, Fix, and Run.`,
  },
  {
    id: "verify",
    title: "Verify",
    eyebrow: "Coverage",
    body: "Run coverage and show an area chart for confidence.",
    icon: FlaskConical,
    prompt:
      `Run \`pnpm_run\` with command "test:coverage" for final verification, then summarize the verification result in one sentence. ${GENERATIVE_UI_PROMPT_GUIDE} Prefer showCoverageAreaChart with confidence rising and failures dropping across Plan, Inspect, Fix, Run, and Verify, then showHarnessSummary with the final pass/fail status.`,
  },
  {
    id: "review",
    title: "Review",
    eyebrow: "Memory",
    body: "Save the handoff and show timeline plus handoff form.",
    icon: CheckCircle2,
    prompt:
      `Save a short handoff post-mortem to file memory with the bug, the patch, and the final verification command. Keep the final response concise. Do not claim there is a separate Review mode; this is the stage review step. ${GENERATIVE_UI_PROMPT_GUIDE} Prefer showRepairCalendar for a simple presenter handoff timeline, showHandoffForm for owner/notes/follow-ups, and showHarnessSummary for the final state.`,
  },
] as const;

type StageStepId = (typeof STAGE_STEPS)[number]["id"];

export function StageRail({
  inDrawer = false,
}: {
  inDrawer?: boolean;
}) {
  const agentState = useControlRoomAgentState();
  const { send, isRunning } = useSendUserMessage();
  const completed = useMemo(
    () => getCompletedSteps(agentState),
    [agentState],
  );
  const activeStepId = useMemo(
    () => STAGE_STEPS.find((step) => !completed.has(step.id))?.id ?? "review",
    [completed],
  );

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col",
        inDrawer ? "p-4" : "p-3 pr-16 lg:p-5",
      )}
    >
      <BrandMasthead />
      <ConnectionStatus />

      <ScrollArea className="min-h-0 flex-1">
        <div
          className={cn(
            "px-1 pb-3 pt-1",
            inDrawer
              ? "grid auto-rows-min gap-4 pr-4"
              : "flex gap-3 lg:grid lg:auto-rows-min lg:gap-4 lg:pr-4",
          )}
        >
          {STAGE_STEPS.map((step) => {
            const Icon = step.icon;
            const isDone = completed.has(step.id);
            const isActive = step.id === activeStepId;
            const canSend = !isRunning;
            return (
              <Card
                key={step.id}
                size="sm"
                className={cn(
                  "min-h-[140px] min-w-[220px] flex-1 gap-0 rounded-3xl py-0 transition-all lg:min-h-0 lg:min-w-0 lg:flex-none",
                  inDrawer && "min-w-0 flex-none",
                  isActive && !isDone
                    ? "border-primary bg-primary/5 shadow-sm ring-2 ring-primary/15"
                    : "border-border/90 shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
                  isDone && "border-primary/25 bg-primary/[0.03]",
                )}
              >
                <CardHeader className="px-4 pt-4 lg:px-5 lg:pt-5">
                  <div className="flex items-start gap-3">
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-8 min-w-8 rounded-xl px-2",
                        isActive && !isDone
                          ? "border-primary bg-primary text-primary-foreground"
                          : isDone
                            ? "border-primary/20 bg-primary/10 text-primary"
                            : "border-primary/20 bg-primary/10 text-primary",
                      )}
                    >
                      {isDone ? <CheckCircle2 size={14} /> : <Icon size={14} />}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center">
                        <CardTitle
                          className={cn(
                            "text-sm",
                            isActive && !isDone && "text-foreground",
                          )}
                        >
                          {step.title}
                        </CardTitle>
                      </div>
                      <CardDescription
                        className={cn(
                          "mt-1 text-[11px] uppercase",
                          isActive && !isDone
                            ? "text-muted-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {step.eyebrow}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-3 lg:flex-none lg:px-5 lg:pb-5">
                  <p
                    className={cn(
                      "line-clamp-2 text-[11px] leading-snug text-muted-foreground sm:text-xs lg:line-clamp-none",
                      isActive && !isDone && "text-foreground",
                    )}
                  >
                    {step.body}
                  </p>
                  <Button
                    type="button"
                    className="w-full"
                    variant="default"
                    size="default"
                    disabled={!canSend}
                    onClick={() => void send(step.prompt)}
                  >
                    <Icon size={13} />
                    {isRunning ? "Agent running" : isDone ? "Run again" : "Start step"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
        <ScrollBar orientation="vertical" />
        <ScrollBar orientation="horizontal" className="lg:hidden" />
      </ScrollArea>
    </div>
  );
}

function BrandMasthead() {
  return (
    <div className="mb-3 rounded-3xl border bg-background px-4 py-3 shadow-sm lg:mb-4 lg:px-5">
      <div className="flex min-w-0 items-center gap-3 text-sm font-semibold tracking-tight text-foreground">
        <span className="flex min-w-0 items-center gap-2">
          <img
            src="/brand/copilotkit-color.svg"
            alt=""
            aria-hidden
            className="size-5 shrink-0"
          />
          <span className="truncate">CopilotKit</span>
        </span>
        <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
        <span className="flex min-w-0 items-center gap-2">
          <img
            src="/brand/microsoft-color.svg"
            alt=""
            aria-hidden
            className="size-5 shrink-0"
          />
          <span className="truncate">Microsoft</span>
        </span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Agent Harness guided repair
      </div>
    </div>
  );
}

function getCompletedSteps(
  state: ReturnType<typeof useControlRoomAgentState>,
): Set<StageStepId> {
  const done = new Set<StageStepId>();
  if (state.todos.length > 0) done.add("plan");
  if ((state.observers?.repo_file_count ?? 0) > 0) done.add("inspect");
  if ((state.approvals?.total ?? 0) > 0 || state.mode === "Act") done.add("fix");
  if (state.observers?.latest_test_command === "test") done.add("run");
  if (
    state.observers?.latest_test_command === "test:coverage" &&
    state.observers.latest_test_success === true
  ) {
    done.add("run");
    done.add("verify");
  }
  if (state.memory.some((entry) => entry.key.toLowerCase().includes("postmortem"))) {
    done.add("review");
  }
  return done;
}

export function AdvancedControlsDrawer({
  iconOnly = false,
}: {
  iconOnly?: boolean;
}) {
  return (
    <Sheet>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size={iconOnly ? "icon" : "default"}
              aria-label="Settings"
              className={cn(
                iconOnly
                  ? topRailButtonClass("slate")
                  : "mt-auto w-full justify-between",
              )}
            >
              <span className="flex items-center gap-2">
                <Settings size={14} />
                {!iconOnly && "Advanced controls"}
              </span>
              {!iconOnly && <Badge variant="secondary">Advanced</Badge>}
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        {iconOnly && (
          <TooltipContent side="bottom" align="center" sideOffset={8}>
            Settings
          </TooltipContent>
        )}
      </Tooltip>
      <SheetContent className="w-[420px] max-w-[92vw] overflow-y-auto p-0 sm:max-w-[420px]">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>Advanced controls</SheetTitle>
          <SheetDescription>
            Tools for setup, manual runs, and debugging.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 bg-muted/25 p-4">
          <EndpointSelector />
          <Card size="sm">
            <CardHeader>
              <CardTitle>Fixture</CardTitle>
              <CardDescription>
                Reset the sandbox or reconnect to the Harness endpoint.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              <FixtureResetButton compact />
              <ReconnectButton />
            </CardContent>
          </Card>
          <ModeControls />
          <CommandControls />
          <StructuredOutputControl />
          <SkillsPanel />
          <StructuredDiagnosisPanel />
          <FeatureAutodetectPanel />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ReconnectButton({ className }: { className?: string }) {
  const { localState, bumpReconnect } = useControlRoomLocal();
  return (
    <Button
      type="button"
      onClick={bumpReconnect}
      className={cn("flex-1", className)}
      variant="outline"
      size="sm"
      title={`Reconnect attempts: ${localState.reconnectAttempts}`}
    >
      <RotateCcw size={13} />
      Reconnect
    </Button>
  );
}

function FixtureResetButton({
  compact = false,
  buttonClassName,
}: {
  compact?: boolean;
  buttonClassName?: string;
}) {
  const { localState } = useControlRoomLocal();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FixtureResetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/fixture/reset", {
        method: "POST",
        headers: {
          [CONTROL_ROOM_ENDPOINT_HEADER]: localState.currentEndpoint,
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setResult((await response.json()) as FixtureResetResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? "flex-1" : ""}>
      {!compact && <h3 className="cr-heading mb-2">Fixture</h3>}
      <Button
        type="button"
        onClick={reset}
        disabled={busy}
        className={cn("w-full", buttonClassName)}
        variant={compact ? "outline" : "secondary"}
        size="sm"
      >
        <RotateCcw size={13} />
        {busy ? "Resetting" : compact ? "Reset" : "Reset fixture repo"}
      </Button>
      {result && !compact ? (
        <p
          className="mt-2 text-[10.5px] uppercase tracking-[0.18em] text-[var(--cr-muted)]"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          {result.reset
            ? `Reset OK · ${result.file_count} file${result.file_count === 1 ? "" : "s"}`
            : "Reset reported no-op."}
        </p>
      ) : null}
      {error && !compact ? (
        <p
          className="mt-2 text-[10.5px] text-[var(--cr-red)]"
          role="alert"
          style={{ fontFamily: "var(--cr-font-mono)" }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
