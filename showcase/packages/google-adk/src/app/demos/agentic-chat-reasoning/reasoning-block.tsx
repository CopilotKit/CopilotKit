"use client";

import React, { useState } from "react";

export function ReasoningBlock({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="my-2 rounded-xl border border-purple-200 bg-purple-50/60">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-purple-700"
        onClick={() => setExpanded((v) => !v)}
      >
        <span>Reasoning</span>
        <span>{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div
          data-testid="reasoning-content"
          className="px-3 pb-3 text-xs text-purple-900 whitespace-pre-wrap"
        >
          {children}
        </div>
      )}
    </div>
  );
}
