import React from "react";
import { allCategories, getEventColors } from "./colors";
import type { Filters } from "./types";

interface FilterBarProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  seenAgentIds: string[];
  seenRunIds: string[];
}

export function FilterBar({
  filters,
  onFiltersChange,
  seenAgentIds,
  seenRunIds,
}: FilterBarProps) {
  const toggleCategory = (eventTypes: string[]) => {
    const allSelected = eventTypes.every((t) => filters.eventTypes.has(t));
    const next = new Set(filters.eventTypes);
    for (const t of eventTypes) {
      if (allSelected) {
        next.delete(t);
      } else {
        next.add(t);
      }
    }
    onFiltersChange({ ...filters, eventTypes: next });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)]">
      <div className="flex flex-wrap gap-1">
        {allCategories.map(({ category, label, eventTypes }) => {
          const colors = getEventColors(eventTypes[0]);
          const someSelected = eventTypes.some((t) =>
            filters.eventTypes.has(t),
          );
          const allSelected = eventTypes.every((t) =>
            filters.eventTypes.has(t),
          );
          return (
            <button
              key={category}
              onClick={() => toggleCategory(eventTypes)}
              className={`px-2 py-0.5 text-xs rounded font-mono ${
                filters.eventTypes.size === 0 || someSelected
                  ? `${colors.bg} ${colors.text}`
                  : "bg-gray-800/40 text-gray-500"
              } ${allSelected ? "ring-1 ring-current" : ""}`}
            >
              {label}
            </button>
          );
        })}
        {filters.eventTypes.size > 0 && (
          <button
            onClick={() =>
              onFiltersChange({ ...filters, eventTypes: new Set() })
            }
            className="px-2 py-0.5 text-xs rounded text-gray-400 hover:text-gray-200"
          >
            Reset
          </button>
        )}
      </div>
      <input
        type="text"
        value={filters.search}
        onChange={(e) =>
          onFiltersChange({ ...filters, search: e.target.value })
        }
        placeholder="Search events..."
        className="px-2 py-1 text-xs bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded font-mono w-48"
      />
      {seenAgentIds.length > 1 && (
        <select
          value={filters.agentId}
          onChange={(e) =>
            onFiltersChange({ ...filters, agentId: e.target.value })
          }
          className="px-2 py-1 text-xs bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded"
        >
          <option value="">All agents</option>
          {seenAgentIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      )}
      {seenRunIds.length > 1 && (
        <select
          value={filters.runId}
          onChange={(e) =>
            onFiltersChange({ ...filters, runId: e.target.value })
          }
          className="px-2 py-1 text-xs bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded"
        >
          <option value="">All runs</option>
          {seenRunIds.map((id) => (
            <option key={id} value={id}>
              {id.slice(0, 12)}...
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
