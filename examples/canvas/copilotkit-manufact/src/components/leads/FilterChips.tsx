"use client";

import { Search, X } from "lucide-react";
import type { LeadFilter } from "@/lib/leads/types";
import { isFilterEmpty } from "@/lib/leads/state";

interface FilterChipsProps {
  filter: LeadFilter;
  onChange: (next: Partial<LeadFilter>) => void;
  onClear: () => void;
}

export function FilterChips({ filter, onChange, onClear }: FilterChipsProps) {
  const empty = isFilterEmpty(filter);

  return (
    <div className="flex flex-wrap items-center gap-2 pb-3">
      <label className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search name, email, role…"
          value={filter.search}
          onChange={(e) => onChange({ search: e.target.value })}
          className="rounded-md border border-border bg-background py-1 pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </label>

      {filter.workshops.map((w) => (
        <Chip
          key={`w-${w}`}
          label="workshop"
          value={w}
          onRemove={() =>
            onChange({ workshops: filter.workshops.filter((x) => x !== w) })
          }
        />
      ))}
      {filter.technical_levels.map((l) => (
        <Chip
          key={`t-${l}`}
          label="level"
          value={l}
          onRemove={() =>
            onChange({
              technical_levels: filter.technical_levels.filter((x) => x !== l),
            })
          }
        />
      ))}
      {filter.tools.map((t) => (
        <Chip
          key={`tool-${t}`}
          label="tool"
          value={t}
          onRemove={() =>
            onChange({ tools: filter.tools.filter((x) => x !== t) })
          }
        />
      ))}
      {filter.opt_in !== "any" ? (
        <Chip
          label="opt-in"
          value={filter.opt_in}
          onRemove={() => onChange({ opt_in: "any" })}
        />
      ) : null}

      {!empty ? (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
        >
          clear all
        </button>
      ) : null}
    </div>
  );
}

function Chip({
  label,
  value,
  onRemove,
}: {
  label: string;
  value: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-foreground">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`remove ${label} filter`}
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
