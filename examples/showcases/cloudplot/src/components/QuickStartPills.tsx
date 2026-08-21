"use client";

import { QUICK_STARTS } from "@/lib/quickStarts";

interface QuickStartPillsProps {
  onSelect: (prompt: string) => void;
}

export function QuickStartPills({ onSelect }: QuickStartPillsProps) {
  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {QUICK_STARTS.map((s) => (
        <button
          key={s.label}
          onClick={() => onSelect(s.prompt)}
          className="px-4 py-2 rounded-full border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 hover:border-gray-400 transition-colors"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
