"use client";

import React from "react";

import type { SubAgentName } from "./delegation-log";

// In-chat activity card for a single sub-agent invocation. Rendered
// inline in the assistant message stream via the per-tool
// `useComponent` registrations in `page.tsx`. Mirrors the
// `SubAgentActivityCard` in the LangGraph-Python reference demo so the
// D6 testid surface (`subagent-card-<role>`, `subagent-activity-task`,
// `subagent-result`, `subagent-status`) is identical across both
// integrations.
//
// The card props mirror the existing built-in-agent surface
// (`{ name, status, parameters, result }`) so the page.tsx
// registrations can pass `useComponent` render props through
// unchanged. `subAgent` is supplied per-registration in page.tsx and
// is the load-bearing role identifier — the testid is keyed off it,
// not off `name`, so the card renders a stable role testid even when
// `useComponent` does not forward the tool name to render props.

export type SubAgentToolStatus = "inProgress" | "executing" | "complete";

const SUB_AGENT_META: Record<
  SubAgentName,
  {
    label: string;
    role: string;
    emoji: string;
    accent: string;
    chip: string;
  }
> = {
  research_agent: {
    label: "Researcher",
    role: "gathering facts",
    emoji: "🔎",
    accent: "border-[#BEC2FF] bg-[#BEC2FF]/15",
    chip: "border-[#BEC2FF] bg-[#BEC2FF1A] text-[#010507]",
  },
  writing_agent: {
    label: "Writer",
    role: "drafting prose",
    emoji: "✍️",
    accent: "border-[#85ECCE4D] bg-[#85ECCE]/10",
    chip: "border-[#85ECCE4D] bg-[#85ECCE]/20 text-[#189370]",
  },
  critique_agent: {
    label: "Critic",
    role: "reviewing the draft",
    emoji: "🧐",
    accent: "border-[#FFAC4D33] bg-[#FFAC4D]/10",
    chip: "border-[#FFAC4D33] bg-[#FFAC4D]/15 text-[#57575B]",
  },
};

// Map the backend tool name (`research_agent`, `writing_agent`,
// `critique_agent`) to the short role used in test selectors. The
// per-role `[data-testid="subagent-card-<role>"]` testid is the stable
// hook the e2e suite uses to count cards and assert per-card content.
const ROLE_TESTID: Record<SubAgentName, "researcher" | "writer" | "critic"> = {
  research_agent: "researcher",
  writing_agent: "writer",
  critique_agent: "critic",
};

export interface SubAgentActivityCardProps {
  /** Required — supplied per `useComponent` registration in page.tsx. */
  subAgent: SubAgentName;
  /** Tool name as seen on the wire (forwarded from useComponent when available). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  name?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  status?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
  /** Some renderers pass `task` directly instead of `parameters.task`. */
  task?: string;
}

function normalizeStatus(raw: unknown): SubAgentToolStatus {
  if (raw === "complete" || raw === "executing" || raw === "inProgress") {
    return raw;
  }
  return "executing";
}

function describeStatus(status: SubAgentToolStatus): string {
  switch (status) {
    case "inProgress":
      return "starting";
    case "executing":
      return "running";
    case "complete":
      return "done";
  }
}

export function SubAgentActivityCard({
  subAgent,
  status: rawStatus,
  parameters,
  result,
  task: taskProp,
}: SubAgentActivityCardProps) {
  const meta = SUB_AGENT_META[subAgent];
  const status = normalizeStatus(rawStatus);
  const done = status === "complete";
  const running = !done;
  const roleTestId = `subagent-card-${ROLE_TESTID[subAgent]}`;

  const task: string | undefined =
    typeof taskProp === "string"
      ? taskProp
      : typeof parameters?.task === "string"
        ? parameters.task
        : undefined;

  // Built-in-agent returns the sub-agent body as a JSON-encoded string
  // (`{ role, text }`). If we get a string, try to parse and prefer the
  // `text` field; fall back to the raw string. Non-string results
  // (objects) are stringified for display.
  let resultText: string | undefined;
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && "text" in parsed) {
          resultText =
            typeof (parsed as { text: unknown }).text === "string"
              ? ((parsed as { text: string }).text as string)
              : JSON.stringify((parsed as { text: unknown }).text);
        } else {
          resultText = trimmed;
        }
      } catch {
        resultText = trimmed;
      }
    }
  } else if (result != null) {
    try {
      resultText = JSON.stringify(result);
    } catch {
      resultText = String(result);
    }
  }

  return (
    <div
      data-testid={roleTestId}
      data-subagent-card={ROLE_TESTID[subAgent]}
      data-sub-agent={subAgent}
      data-status={status}
      className={`my-3 overflow-hidden rounded-2xl border bg-white shadow-sm ${meta.accent}`}
    >
      <div className="flex items-center justify-between border-b border-[#E9E9EF] bg-[#FAFAFC] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-base leading-none">
            {meta.emoji}
          </span>
          <span className="text-sm font-semibold text-[#010507]">
            {meta.label}
          </span>
          <span className="text-[11px] text-[#838389]">
            {running ? `is ${meta.role}…` : `finished ${meta.role}`}
          </span>
        </div>
        <StatusBadge status={status} chipTone={meta.chip} />
      </div>

      <div className="grid gap-3 p-4 text-sm">
        <Section label="Task">
          {task ? (
            <p
              data-testid="subagent-activity-task"
              className="rounded-lg border border-[#E9E9EF] bg-[#FAFAFC] p-2.5 text-xs text-[#010507] whitespace-pre-wrap"
            >
              {task}
            </p>
          ) : (
            <p className="text-xs italic text-[#838389]">
              waiting for the supervisor to spell out the task…
            </p>
          )}
        </Section>

        <Section label="Result">
          {done ? (
            <div
              data-testid="subagent-result"
              data-subagent-result-role={ROLE_TESTID[subAgent]}
              className="rounded-lg border border-[#E9E9EF] bg-white p-2.5 text-xs text-[#010507] whitespace-pre-wrap"
            >
              {resultText && resultText.length > 0 ? resultText : "(empty)"}
            </div>
          ) : (
            <p className="inline-flex items-center gap-2 text-xs italic text-[#57575B]">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#010507]" />
              {meta.label} is working…
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#838389]">
        {label}
      </div>
      {children}
    </div>
  );
}

function StatusBadge({
  status,
  chipTone,
}: {
  status: SubAgentToolStatus;
  chipTone: string;
}) {
  const label = describeStatus(status);
  return (
    <span
      data-testid="subagent-status"
      data-status={status}
      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ${chipTone}`}
    >
      {label}
    </span>
  );
}
