"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { Badge } from "./badge";

// Catch-all tool-call renderer for the tool-rendering-default-catchall
// demo, restyled with inline-cloned shadcn primitives. The demo's
// conceptual point is unchanged: a SINGLE wildcard renderer paints every
// tool call (no per-tool renderers). We just give that wildcard a
// shadcn-flavored visual.

export type CatchallToolStatus = "inProgress" | "executing" | "complete";

export interface ShadcnCatchallRendererProps {
  name: string;
  status: CatchallToolStatus;
  parameters: unknown;
  result: string | undefined;
}

export function ShadcnCatchallRenderer({
  name,
  status,
  parameters,
  result,
}: ShadcnCatchallRendererProps) {
  const parsedResult = parseResult(result);
  const done = status === "complete";

  return (
    <Card
      data-testid="shadcn-catchall-card"
      data-tool-name={name}
      data-status={status}
      className="my-3 overflow-hidden"
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-neutral-200 bg-neutral-50/60 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
            Tool
          </span>
          <CardTitle
            data-testid="shadcn-catchall-tool-name"
            className="font-mono text-sm text-neutral-900"
          >
            {name}
          </CardTitle>
        </div>
        <StatusBadge status={status} />
      </CardHeader>

      <CardContent className="grid gap-3 p-4 text-sm">
        <Section label="Arguments">
          <pre
            data-testid="shadcn-catchall-args"
            className="overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 p-2.5 font-mono text-xs text-neutral-900"
          >
            {safeStringify(parameters)}
          </pre>
        </Section>

        <Section label="Result">
          {done ? (
            <pre
              data-testid="shadcn-catchall-result"
              className="overflow-x-auto rounded-md border border-emerald-200 bg-emerald-50 p-2.5 font-mono text-xs text-neutral-900"
            >
              {parsedResult !== undefined
                ? safeStringify(parsedResult)
                : "(empty)"}
            </pre>
          ) : (
            <p className="text-xs italic text-neutral-500">
              waiting for tool to finish…
            </p>
          )}
        </Section>
      </CardContent>
    </Card>
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
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: CatchallToolStatus }) {
  const { label, variant } = describeStatus(status);
  return (
    <Badge data-testid="shadcn-catchall-status" variant={variant}>
      {label}
    </Badge>
  );
}

function describeStatus(status: CatchallToolStatus): {
  label: string;
  variant: "secondary" | "warning" | "success";
} {
  switch (status) {
    case "inProgress":
      return { label: "streaming", variant: "warning" };
    case "executing":
      return { label: "running", variant: "secondary" };
    case "complete":
      return { label: "done", variant: "success" };
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
