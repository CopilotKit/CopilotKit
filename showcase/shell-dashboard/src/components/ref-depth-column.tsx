"use client";
/**
 * RefDepthColumn -- header cell and data cell pair for the frozen "Ref Depth"
 * column that appears when the Parity overlay is active.
 */
import { DepthChip } from "@/components/depth-chip";

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */

export function RefDepthHeader() {
  return (
    <th
      className="sticky left-[160px] top-0 z-30 px-1.5 py-1.5 text-left border-b border-r-2 border-r-[#c4b5fd] border-l border-[var(--border)] font-normal"
      style={{ backgroundColor: "#f5f0ff" }}
    >
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[#7c3aed] leading-tight">
        <span>Ref</span>
        <br />
        <span>Depth</span>
      </div>
    </th>
  );
}

/* ------------------------------------------------------------------ */
/*  Data cell                                                          */
/* ------------------------------------------------------------------ */

export interface RefDepthCellProps {
  depth: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  status: "wired" | "stub" | "unshipped" | "unsupported";
  /** Structural ceiling for this cell — drives graduated chip coloring. */
  maxDepth?: number;
}

export function RefDepthCell({ depth, status, maxDepth }: RefDepthCellProps) {
  return (
    <td
      className="sticky left-[160px] z-10 px-1.5 py-1 border-r-2 border-r-[#c4b5fd] border-l border-[var(--border)] align-top"
      style={{ backgroundColor: "#f5f0ff" }}
    >
      <DepthChip depth={depth} status={status} maxDepth={maxDepth} />
    </td>
  );
}
