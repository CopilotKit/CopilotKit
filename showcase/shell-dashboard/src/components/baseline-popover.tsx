/**
 * BaselinePopover — click-to-edit popover with status selector + tag toggles
 * for the Baseline tab.
 */
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { BaselineStatus, BaselineTag } from "../lib/baseline-types";
import {
  STATUSES,
  TAGS,
  INDIVIDUAL_TAGS,
  STATUS_CONFIG,
  TAG_BADGE_CONFIG,
} from "../lib/baseline-types";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface BaselinePopoverProps {
  status: BaselineStatus;
  tags: BaselineTag[];
  onSave: (status: BaselineStatus, tags: BaselineTag[]) => void;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Status labels                                                      */
/* ------------------------------------------------------------------ */

const STATUS_LABELS: Record<BaselineStatus, string> = {
  works: "Works",
  possible: "Possible",
  impossible: "Impossible",
  unknown: "Unknown",
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function BaselinePopover({
  status: initialStatus,
  tags: initialTags,
  onSave,
  onClose,
}: BaselinePopoverProps) {
  const [status, setStatus] = useState<BaselineStatus>(initialStatus);
  const [selectedTags, setSelectedTags] = useState<Set<BaselineTag>>(
    () => new Set(initialTags),
  );
  const ref = useRef<HTMLDivElement>(null);

  /* ---- save + close helper ---- */
  const saveAndClose = useCallback(() => {
    onSave(status, [...selectedTags]);
    onClose();
  }, [status, selectedTags, onSave, onClose]);

  /* ---- click outside → save + close ---- */
  // Skip the initial click that opened the popover: the td's onClick fires
  // on the same event as this mousedown listener would catch, immediately
  // closing the popover. Defer listener attachment to the next frame.
  useEffect(() => {
    let rafId: number;
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        saveAndClose();
      }
    }
    rafId = requestAnimationFrame(() => {
      document.addEventListener("mousedown", handleMouseDown);
    });
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [saveAndClose]);

  /* ---- escape → save + close ---- */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        saveAndClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [saveAndClose]);

  /* ---- status change handler ---- */
  function handleStatusClick(s: BaselineStatus) {
    setStatus(s);
    if (s !== "possible") {
      setSelectedTags(new Set());
    } else if (s === "possible" && selectedTags.size === 0) {
      setSelectedTags(new Set<BaselineTag>(["all"]));
    }
  }

  /* ---- tag toggle handler ---- */
  function handleTagToggle(tag: BaselineTag) {
    setSelectedTags((prev) => {
      const next = new Set(prev);

      if (tag === "all") {
        // Toggling ALL on → clears individual tags, adds "all"
        next.clear();
        next.add("all");
        return next;
      }

      // Toggling an individual tag when ALL is selected → clear "all", add that tag
      if (next.has("all")) {
        next.delete("all");
        next.add(tag);
        return next;
      }

      // Normal toggle
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }

      // If all 6 individual tags selected → auto-convert to "all"
      if (next.size === INDIVIDUAL_TAGS.length) {
        const allIndividual = INDIVIDUAL_TAGS.every((t) => next.has(t));
        if (allIndividual) {
          next.clear();
          next.add("all");
          return next;
        }
      }

      // Minimum 1 tag: if empty, default to "all"
      if (next.size === 0) {
        next.add("all");
      }

      return next;
    });
  }

  // Tags only enabled for "possible". Impossible = impossible, no qualifiers.
  const tagsDisabled = status !== "possible";

  return (
    <div
      ref={ref}
      data-testid="baseline-popover"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)] min-w-[200px]"
    >
      {/* ---- Status row ---- */}
      <div className="flex gap-1" data-testid="status-row">
        {STATUSES.map((s) => {
          const cfg = STATUS_CONFIG[s];
          const selected = s === status;
          return (
            <button
              key={s}
              data-testid={`status-${s}`}
              onClick={() => handleStatusClick(s)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-opacity ${
                selected
                  ? "border-current opacity-100"
                  : "border-transparent opacity-50"
              }`}
              style={{ backgroundColor: cfg.bgColor, color: cfg.color }}
            >
              <span>{cfg.emoji}</span>
              <span>{STATUS_LABELS[s]}</span>
            </button>
          );
        })}
      </div>

      {/* ---- Divider ---- */}
      <div className="h-px bg-[var(--border)] my-1.5" />

      {/* ---- Tags row ---- */}
      <div
        className={`flex flex-wrap gap-1 transition-opacity ${
          tagsDisabled ? "opacity-20 pointer-events-none" : ""
        }`}
        data-testid="tags-row"
      >
        {TAGS.map((tag) => {
          const cfg = TAG_BADGE_CONFIG[tag];
          const selected = selectedTags.has(tag);
          return (
            <button
              key={tag}
              data-testid={`tag-${tag}`}
              onClick={() => handleTagToggle(tag)}
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs border transition-opacity ${
                selected
                  ? "opacity-100 border-current"
                  : "opacity-30 border-transparent"
              }`}
              style={{ backgroundColor: cfg.bgColor, color: cfg.color }}
            >
              <span>{cfg.label}</span>
              <span className="uppercase">{tag}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
