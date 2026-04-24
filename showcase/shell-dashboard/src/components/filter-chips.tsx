"use client";
/**
 * FilterChips — pill-shaped toggle chips for filtering the cell matrix.
 *
 * Active chip has a blue border + subtle fill.
 */
import { useState } from "react";

export type FilterMode = "all" | "wired" | "gaps" | "regressions" | "reference";

export interface FilterChipsProps {
  /** Called when the active filter changes. */
  onChange: (mode: FilterMode) => void;
  /** Initial filter mode. */
  initial?: FilterMode;
}

const FILTERS: Array<{ id: FilterMode; label: string }> = [
  { id: "all", label: "All" },
  { id: "wired", label: "Wired" },
  { id: "gaps", label: "Gaps" },
  { id: "regressions", label: "Regressions" },
  { id: "reference", label: "Reference" },
];

export function FilterChips({ onChange, initial = "all" }: FilterChipsProps) {
  const [active, setActive] = useState<FilterMode>(initial);

  const select = (mode: FilterMode) => {
    setActive(mode);
    onChange(mode);
  };

  return (
    <div data-testid="filter-chips" className="flex items-center gap-2 flex-wrap">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          data-testid={`filter-chip-${f.id}`}
          onClick={() => select(f.id)}
          className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors border cursor-pointer ${
            active === f.id
              ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
              : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
