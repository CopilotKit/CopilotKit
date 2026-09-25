"use client";

import { useState } from "react";
import type { MapPick } from "@/lib/homepage-map";
import { PRIORITY_GROUPS } from "@/lib/integration-groups";
import { PickLogoMark } from "./docs-map-parts";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function WizardBackendPicker({
  picks,
  selectedId,
  onSelect,
}: {
  picks: readonly MapPick[];
  selectedId?: string;
  onSelect: (id: string, pointerActivated: boolean) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const grouped = new Set(
    PRIORITY_GROUPS.flatMap((group) =>
      group.choices.map((choice) => choice.slug),
    ),
  );
  const groups = [
    ...PRIORITY_GROUPS.map((group) => ({
      ...group,
      choices: group.choices.filter((choice) =>
        picks.some((pick) => pick.id === choice.slug),
      ),
    })),
    ...picks
      .filter((pick) => !grouped.has(pick.id))
      .map((pick) => ({
        id: pick.id,
        name: pick.name,
        choices: [{ slug: pick.id, name: pick.name }],
      })),
  ].filter((group) => group.choices.length);
  return (
    <div className="wizard-backend-grid grid grid-cols-2 gap-2 sm:grid-cols-4">
      {groups.map((group) => {
        const pick = picks.find(
          (candidate) => candidate.id === group.choices[0].slug,
        )!;
        const selected = group.choices.some(
          (choice) => choice.slug === selectedId,
        );
        const button = (
          <button
            type="button"
            aria-pressed={selected}
            onClick={
              group.choices.length === 1
                ? (event) => onSelect(pick.id, event.detail > 0)
                : undefined
            }
            className={`shell-docs-radius-control flex min-h-14 cursor-pointer items-center gap-2 border px-3 py-2 text-left text-xs font-medium ${selected ? "border-[var(--accent)] bg-[var(--accent-dim)]" : "border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)]"}`}
          >
            <span aria-hidden="true">
              <PickLogoMark logo={pick.logo} size={18} />
            </span>
            {group.name}
          </button>
        );
        return group.choices.length === 1 ? (
          <div key={group.id} className="grid">
            {button}
          </div>
        ) : (
          <Popover
            key={group.id}
            open={open === group.id}
            onOpenChange={(value) => setOpen(value ? group.id : null)}
          >
            <PopoverTrigger asChild>{button}</PopoverTrigger>
            <PopoverContent align="start" aria-label={`${group.name} language`}>
              <p className="px-3 py-2 text-xs text-[var(--text-muted)]">
                Choose your language
              </p>
              {group.choices.map((choice) => (
                <button
                  key={choice.slug}
                  type="button"
                  className="block w-full cursor-pointer rounded-lg px-3 py-3 text-left hover:bg-[var(--accent-dim)]"
                  onClick={(event) => {
                    setOpen(null);
                    onSelect(choice.slug, event.detail > 0);
                  }}
                >
                  {choice.name}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}
