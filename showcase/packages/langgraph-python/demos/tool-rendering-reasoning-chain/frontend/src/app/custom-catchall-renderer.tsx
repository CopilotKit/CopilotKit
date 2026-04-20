"use client";

import React from "react";

// Branded catch-all renderer for tools that don't have a dedicated
// per-tool renderer. Duplicated from the primary `tool-rendering` cell
// — each cell is self-contained.

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
      className="my-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex items-center justify-between bg-gradient-to-r from-slate-900 to-slate-700 px-4 py-2 text-white">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-slate-300">
            Tool
          </span>
          <span
            data-testid="custom-catchall-tool-name"
            className="font-mono text-sm"
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
            className="overflow-x-auto rounded bg-slate-50 p-2 font-mono text-xs text-slate-800"
          >
            {safeStringify(parameters)}
          </pre>
        </Section>

        <Section label="Result">
          {done ? (
            <pre
              data-testid="custom-catchall-result"
              className="overflow-x-auto rounded bg-emerald-50 p-2 font-mono text-xs text-emerald-900"
            >
              {parsedResult !== undefined
                ? safeStringify(parsedResult)
                : "(empty)"}
            </pre>
          ) : (
            <p className="text-xs italic text-slate-500">
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
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">
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
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
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
        label: "streaming args",
        tone: "bg-amber-200 text-amber-900",
      };
    case "executing":
      return {
        label: "running",
        tone: "bg-blue-200 text-blue-900",
      };
    case "complete":
      return {
        label: "done",
        tone: "bg-emerald-200 text-emerald-900",
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
