"use client";

import { useState } from "react";

import { QUICK_STARTS } from "@/lib/quickStarts";

interface QuickStartPillsProps {
  onSelect: (prompt: string) => Promise<void>;
}

export function QuickStartPills({ onSelect }: QuickStartPillsProps) {
  const [executionError, setExecutionError] = useState<string | null>(null);

  const handleSelect = (prompt: string) => {
    setExecutionError(null);
    // React does not await click handlers, so handle and surface the run here.
    onSelect(prompt).catch((error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown agent execution error";
      setExecutionError(`Unable to run CloudPlot: ${message}`);
    });
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap gap-2 justify-center">
        {QUICK_STARTS.map((s) => (
          <button
            key={s.label}
            onClick={() => handleSelect(s.prompt)}
            className="px-4 py-2 rounded-full border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 hover:border-gray-400 transition-colors"
          >
            {s.label}
          </button>
        ))}
      </div>
      {executionError && (
        <p role="alert" className="text-sm text-red-600">
          {executionError}
        </p>
      )}
    </div>
  );
}
