"use client";

import React from "react";

interface CustomCatchallRendererProps {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  status: "executing" | "complete" | "incomplete";
}

const FALLBACK_RESULT_LABEL = "tool returned no payload";

export function CustomCatchallRenderer({
  name,
  args,
  result,
  status,
}: CustomCatchallRendererProps) {
  const formatted = result === undefined || result === null
    ? FALLBACK_RESULT_LABEL
    : typeof result === "string"
      ? result
      : JSON.stringify(result, null, 2);

  return (
    <div
      data-testid="custom-catchall-card"
      className="my-2 rounded-xl border border-[#1A73E8]/20 bg-gradient-to-br from-blue-50 via-white to-purple-50 p-4 shadow-sm"
    >
      <header className="flex items-center justify-between mb-3">
        <span className="text-[11px] uppercase tracking-wider text-[#1A73E8] font-medium">
          tool · {name}
        </span>
        <span
          className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
            status === "complete"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : status === "executing"
                ? "bg-amber-50 text-amber-700 border border-amber-200"
                : "bg-gray-50 text-gray-700 border border-gray-200"
          }`}
        >
          {status}
        </span>
      </header>
      <div className="text-xs text-[#57575B] mb-1">arguments</div>
      <pre className="text-xs text-[#010507] bg-white border border-[#E9E9EF] rounded-lg p-2.5 overflow-x-auto font-mono">
        {JSON.stringify(args ?? {}, null, 2)}
      </pre>
      {status === "complete" && (
        <>
          <div className="text-xs text-[#57575B] mt-3 mb-1">result</div>
          <pre className="text-xs text-[#010507] bg-white border border-[#E9E9EF] rounded-lg p-2.5 overflow-x-auto font-mono whitespace-pre-wrap">
            {formatted}
          </pre>
        </>
      )}
    </div>
  );
}
