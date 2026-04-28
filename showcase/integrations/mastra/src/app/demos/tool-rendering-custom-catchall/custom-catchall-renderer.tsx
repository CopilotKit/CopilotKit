"use client";

import React from "react";

// Branded catch-all renderer for the tool-rendering-custom-catchall cell.

export type CatchallToolStatus = "inProgress" | "executing" | "complete";

export interface CustomCatchallRendererProps {
  name: string;
  status: CatchallToolStatus;
  parameters: unknown;
  result: string | undefined;
}

export function CustomCatchallRenderer({
  name,
  status,
  parameters,
  result,
}: CustomCatchallRendererProps) {
  const parsedResult = parseResult(result);
  const done = status === "complete";

  return (
    <div
      data-testid="custom-catchall-card"
      data-tool-name={name}
      data-status={status}
      className="my-3 overflow-hidden rounded-2xl border border-[#DBDBE5] bg-white shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-[#E9E9EF] bg-[#FAFAFC] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-[#838389]">
            Tool
          </span>
          <span
            data-testid="custom-catchall-tool-name"
            className="font-mono text-sm text-[#010507]"
          >
            {name}
          </span>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="grid gap-3 p-4 text-sm">
        <Section label="Arguments">
          <pre
            data-testid="custom-catchall-args"
            className="overflow-x-auto rounded-lg border border-[#E9E9EF] bg-[#FAFAFC] p-2.5 font-mono text-xs text-[#010507]"
          >
            {safeStringify(parameters)}
          </pre>
        </Section>

        <Section label="Result">
          {done ? (
            <pre
              data-testid="custom-catchall-result"
              className="overflow-x-auto rounded-lg border border-[#85ECCE4D] bg-[#85ECCE]/10 p-2.5 font-mono text-xs text-[#010507]"
            >
              {parsedResult !== undefined
                ? safeStringify(parsedResult)
                : "(empty)"}
            </pre>
          ) : (
            <p className="text-xs italic text-[#838389]">
              waiting for tool to finish…
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

function StatusBadge({ status }: { status: CatchallToolStatus }) {
  const { label, tone } = describeStatus(status);
  return (
    <span
      data-testid="custom-catchall-status"
      className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ${tone}`}
    >
      {label}
    </span>
  );
}

function describeStatus(status: CatchallToolStatus): {
  label: string;
  tone: string;
} {
  switch (status) {
    case "inProgress":
      return {
        label: "streaming",
        tone: "border border-[#FFAC4D33] bg-[#FFAC4D]/15 text-[#57575B]",
      };
    case "executing":
      return {
        label: "running",
        tone: "border border-[#BEC2FF] bg-[#BEC2FF1A] text-[#010507]",
      };
    case "complete":
      return {
        label: "done",
        tone: "border border-[#85ECCE4D] bg-[#85ECCE]/20 text-[#189370]",
      };
  }
}

function parseResult(result: string | undefined): unknown {
  if (result === undefined || result === null) return undefined;
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
