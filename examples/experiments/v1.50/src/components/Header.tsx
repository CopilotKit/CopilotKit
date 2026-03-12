"use client";

import type { Branch } from "@/types";

interface HeaderProps {
  branches?: Branch[];
  currentBranch?: Branch;
  onCreateBranch?: (name: string) => void;
  onSwitchBranch?: (branchId: string) => void;
}

export function Header({
  branches,
  currentBranch,
  onCreateBranch,
  onSwitchBranch,
}: HeaderProps) {
  return (
    <header className="h-14 px-6 border-b bg-white flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-xl font-semibold text-gray-900">CopilotKit</span>
        <span className="text-xl">🪁</span>
      </div>

      {branches && currentBranch && onSwitchBranch && onCreateBranch && (
        <div className="flex items-center gap-2">
          {/* Branch dropdown */}
          <select
            value={currentBranch.id}
            onChange={(e) => onSwitchBranch(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          {/* Fork button */}
          <button
            onClick={() => onCreateBranch(`Fork ${branches.length + 1}`)}
            className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            + Fork
          </button>
        </div>
      )}
    </header>
  );
}
