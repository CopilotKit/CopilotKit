"use client";

import React from "react";

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
          <span className="font-mono text-sm text-[#010507]">{name}</span>
        </div>
        <span className="rounded-full border border-[#DBDBE5] bg-[#FAFAFC] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#57575B]">
          {status}
        </span>
      </div>
      <div className="grid gap-3 p-4 text-sm">
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#838389]">
            Arguments
          </div>
          <pre className="overflow-x-auto rounded-lg border border-[#E9E9EF] bg-[#FAFAFC] p-2.5 font-mono text-xs text-[#010507]">
            {safeStringify(parameters)}
          </pre>
        </div>
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#838389]">
            Result
          </div>
          {done ? (
            <pre className="overflow-x-auto rounded-lg border border-[#85ECCE4D] bg-[#85ECCE]/10 p-2.5 font-mono text-xs text-[#010507]">
              {parsedResult !== undefined
                ? safeStringify(parsedResult)
                : "(empty)"}
            </pre>
          ) : (
            <p className="text-xs italic text-[#838389]">
              waiting for tool to finish...
            </p>
          )}
        </div>
      </div>
    </div>
  );
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
