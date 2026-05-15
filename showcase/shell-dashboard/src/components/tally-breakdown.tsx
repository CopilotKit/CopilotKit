"use client";
/**
 * TallyBreakdownPopover — popover showing which features/signals fall in a
 * particular tally bucket (green / amber / red).  TallyTrigger wraps each
 * tally count span and handles hover-open + click-pin semantics.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { TallyItem } from "@/components/tally-types";

// ---------------------------------------------------------------------------
// Popover (internal)
// ---------------------------------------------------------------------------

interface TallyBreakdownPopoverProps {
  items: TallyItem[];
  tone: "green" | "amber" | "red";
  onClose: () => void;
}

const TONE_DOT: Record<string, string> = {
  green: "bg-[var(--ok)]",
  amber: "bg-[var(--amber)]",
  red: "bg-[var(--danger)]",
};

function TallyBreakdownPopover({
  items,
  tone,
  onClose: _onClose,
}: TallyBreakdownPopoverProps) {
  return (
    <div
      data-testid="tally-popover"
      className="absolute z-50 mt-1 min-w-[180px] max-w-[280px] max-h-[200px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg"
      role="dialog"
      aria-label={`${tone} tally breakdown`}
    >
      <ul className="py-1.5 px-2 space-y-1">
        {items.map((item, i) => (
          <li
            key={item.featureId ?? `${item.label}-${i}`}
            className="flex items-center gap-2 py-0.5"
          >
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[tone]}`}
            />
            <span className="text-[11px] text-[var(--text)] truncate">
              {item.label}
            </span>
            <span className="ml-auto text-[9px] text-[var(--text-muted)] uppercase tracking-wider shrink-0">
              {item.dimension}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trigger wrapper (exported)
// ---------------------------------------------------------------------------

interface TallyTriggerProps {
  items: TallyItem[];
  tone: "green" | "amber" | "red";
  children: React.ReactNode;
}

export function TallyTrigger({ items, tone, children }: TallyTriggerProps) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const clearTimers = useCallback(() => {
    if (hoverTimeout.current) {
      clearTimeout(hoverTimeout.current);
      hoverTimeout.current = null;
    }
    if (leaveTimeout.current) {
      clearTimeout(leaveTimeout.current);
      leaveTimeout.current = null;
    }
  }, []);

  // Close on click-outside (same pattern as DepthLayer in composed-cell.tsx)
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        pinned.current = false;
        clearTimers();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, clearTimers]);

  // Cleanup timers on unmount
  useEffect(() => clearTimers, [clearTimers]);

  const hasItems = items.length > 0;

  const handleClick = () => {
    if (!hasItems) return;
    clearTimers();
    if (open && pinned.current) {
      // Click again while pinned → close
      setOpen(false);
      pinned.current = false;
    } else {
      // Pin open
      setOpen(true);
      pinned.current = true;
    }
  };

  const handleMouseEnter = () => {
    if (!hasItems) return;
    if (leaveTimeout.current) {
      clearTimeout(leaveTimeout.current);
      leaveTimeout.current = null;
    }
    if (!open) {
      hoverTimeout.current = setTimeout(() => {
        setOpen(true);
      }, 200);
    }
  };

  const handleMouseLeave = () => {
    if (!hasItems) return;
    if (hoverTimeout.current) {
      clearTimeout(hoverTimeout.current);
      hoverTimeout.current = null;
    }
    // Don't close if click-pinned
    if (!pinned.current) {
      leaveTimeout.current = setTimeout(() => {
        setOpen(false);
      }, 150);
    }
  };

  const handleClose = useCallback(() => {
    setOpen(false);
    pinned.current = false;
    clearTimers();
  }, [clearTimers]);

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        data-testid={`tally-trigger-${tone}`}
        className={`bg-transparent border-none p-0 inline-flex${hasItems ? " cursor-pointer" : ""}`}
        onClick={handleClick}
      >
        {children}
      </button>
      {open && hasItems && (
        <TallyBreakdownPopover
          items={items}
          tone={tone}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
