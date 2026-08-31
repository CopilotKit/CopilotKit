"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./_components/card";
import { Badge } from "./_components/badge";

// ShadCN-styled catch-all renderer for the tool-rendering-custom-catchall
// cell. A single wildcard renderer handles every tool call — name,
// status, arguments, and result rendered inside a shadcn <Card />.

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
    <Card
      data-testid="custom-wildcard-card"
      data-tool-name={name}
      data-status={status}
      className="my-3 overflow-hidden"
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-neutral-200 bg-neutral-50/60 py-3">
        <div className="flex items-center gap-2">
          <CardTitle
            data-testid="custom-wildcard-tool-name"
            className="font-mono text-sm text-neutral-900"
          >
            {name}
          </CardTitle>
          <CardDescription className="text-[10px] uppercase tracking-wider text-neutral-500">
            tool call
          </CardDescription>
        </div>
        <StatusBadge status={status} />
      </CardHeader>

      <CardContent className="grid gap-3 p-4 text-sm">
        <Section label="Arguments">
          <pre
            data-testid="custom-wildcard-args"
            className="overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 p-2.5 font-mono text-xs text-neutral-900"
          >
            {safeStringify(parameters)}
          </pre>
        </Section>

        <Section label="Result">
          {done ? (
            <pre
              data-testid="custom-wildcard-result"
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
  const { label, variant, dot } = describeStatus(status);
  return (
    <Badge data-testid="custom-wildcard-status" variant={variant}>
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`}
        aria-hidden
      />
      {label}
    </Badge>
  );
}

function describeStatus(status: CatchallToolStatus): {
  label: string;
  variant: "warning" | "secondary" | "success";
  dot: string;
} {
  switch (status) {
    case "inProgress":
      return {
        label: "streaming",
        variant: "warning",
        dot: "bg-amber-500 animate-pulse",
      };
    case "executing":
      return {
        label: "running",
        variant: "secondary",
        dot: "bg-neutral-500 animate-pulse",
      };
    case "complete":
      return {
        label: "done",
        variant: "success",
        dot: "bg-emerald-500",
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
