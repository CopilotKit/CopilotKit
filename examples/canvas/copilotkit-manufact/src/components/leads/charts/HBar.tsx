"use client";

import { motion } from "motion/react";
import type { DemandRow } from "@/lib/leads/derive";

interface HBarProps {
  rows: DemandRow[];
  total?: number;
  rowClassName?: (label: string) => string;
  /** Optional click handler to filter on a label. */
  onClickRow?: (label: string) => void;
}

export function HBar({ rows, total, rowClassName, onClickRow }: HBarProps) {
  const max = total ?? Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const pct = (r.count / max) * 100;
        const barClass = rowClassName?.(r.label) ?? "bg-primary/70";
        const interactive = !!onClickRow;
        return (
          <motion.li
            key={r.label}
            layout
            transition={{ type: "spring", stiffness: 360, damping: 32 }}
            className={`group grid grid-cols-[160px_1fr_36px] items-center gap-3 ${
              interactive ? "cursor-pointer" : ""
            }`}
            onClick={interactive ? () => onClickRow!(r.label) : undefined}
          >
            <span className="truncate text-xs text-muted-foreground group-hover:text-foreground">
              {r.label}
            </span>
            <span className="relative h-3 overflow-hidden rounded bg-muted">
              <motion.span
                className={`absolute inset-y-0 left-0 rounded ${barClass}`}
                initial={false}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              />
            </span>
            <span className="text-right text-xs font-medium tabular-nums text-foreground">
              {r.count}
            </span>
          </motion.li>
        );
      })}
    </ul>
  );
}
