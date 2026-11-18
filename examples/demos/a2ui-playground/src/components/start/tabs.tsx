"use client";

import type { ReactNode } from "react";
import { cn, focusRing } from "@/lib/utils";

/**
 * A segmented tab list: one tab stop, arrow keys move the choice. `size="lg"` is the page's mode switch,
 * `size="sm"` sits on top of a code block (package manager, coding agent).
 */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
  label,
  idBase,
  size = "sm",
  className,
}: {
  options: Array<{ id: T; label: ReactNode }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** Tab ids are `${idBase}-tab-${id}`, panels `${idBase}-panel-${id}`. */
  idBase: string;
  size?: "sm" | "lg";
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[10px] bg-black/[0.045] p-[3px] dark:bg-white/[0.06]",
        className,
      )}
      onKeyDown={(e) => {
        const step =
          e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const at = options.findIndex((o) => o.id === value);
        const next = options[(at + step + options.length) % options.length].id;
        onChange(next);
        document.getElementById(`${idBase}-tab-${next}`)?.focus();
      }}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            id={`${idBase}-tab-${o.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`${idBase}-panel-${o.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.id)}
            className={cn(
              "inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-[8px] font-medium transition-colors",
              size === "lg"
                ? "h-9 px-4 text-[14px]"
                : "h-7 px-2.5 text-[12.5px]",
              on
                ? "bg-card text-foreground shadow-[0_1px_2px_oklch(var(--ink)/10%)] dark:bg-white/[0.1] dark:shadow-none"
                : "text-muted-foreground hover:text-foreground",
              focusRing,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
