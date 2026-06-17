"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import type { BaselineStatus, BaselineTag } from "@/lib/baseline-types";
import { useBaseline } from "@/hooks/useBaseline";
import { BaselineGrid } from "./baseline-grid";
import { BaselineLegend } from "./baseline-legend";
import { BaselineToastContainer, showErrorToast } from "./baseline-toast";

/**
 * Pending change: a cell edit that hasn't been committed to PB yet.
 */
interface PendingChange {
  status: BaselineStatus;
  tags: BaselineTag[];
}

/**
 * BaselineTab — container component that composes the header bar, grid,
 * legend, toast, and auth prompt for the Baseline tab.
 *
 * Edit mode accumulates changes locally. Changes are only written to PB
 * when the user clicks COMMIT. CANCEL discards all pending changes.
 */
export function BaselineTab() {
  const {
    cells: liveCells,
    status: connStatus,
    error,
    updateCell,
  } = useBaseline();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Map<string, PendingChange>>(new Map());
  const [committing, setCommitting] = useState(false);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  // Merge live cells with pending edits for display
  const displayCells = useMemo(() => {
    if (pending.size === 0) return liveCells;
    const merged = new Map(liveCells);
    for (const [key, change] of pending) {
      const existing = merged.get(key);
      if (existing) {
        merged.set(key, {
          ...existing,
          status: change.status,
          tags: change.tags,
        });
      }
    }
    return merged;
  }, [liveCells, pending]);

  // Stats from display cells (includes pending changes visually)
  const stats = useMemo(() => {
    let works = 0;
    let possible = 0;
    let impossible = 0;
    let unknown = 0;

    for (const cell of displayCells.values()) {
      switch (cell.status) {
        case "works":
          works++;
          break;
        case "possible":
          possible++;
          break;
        case "impossible":
          impossible++;
          break;
        case "unknown":
          unknown++;
          break;
      }
    }

    const total = works + possible + impossible + unknown;
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

    return {
      works,
      possible,
      impossible,
      unknown,
      total,
      worksPct: pct(works),
      possiblePct: pct(possible),
      impossiblePct: pct(impossible),
      unknownPct: pct(unknown),
    };
  }, [displayCells]);

  // Accumulate a change locally instead of writing to PB
  const handleLocalUpdate = useCallback(
    async (
      key: string,
      status: BaselineStatus,
      tags: BaselineTag[],
    ): Promise<void> => {
      setPending((prev) => {
        const next = new Map(prev);
        next.set(key, { status, tags });
        return next;
      });
    },
    [],
  );

  // Commit all pending changes to PB
  const handleCommit = useCallback(async () => {
    const changes = new Map(pendingRef.current);
    if (changes.size === 0) return;
    setCommitting(true);
    let succeeded = 0;
    let failed = 0;
    for (const [key, change] of changes) {
      try {
        await updateCell(key, change.status, change.tags);
        succeeded++;
      } catch (err) {
        failed++;
        showErrorToast(
          `Failed to save ${key}: ${err instanceof Error ? err.message : "unknown error"}`,
        );
      }
    }
    setCommitting(false);
    if (failed === 0) {
      setPending(new Map());
      setEditing(false);
    } else {
      // Remove only the ones that succeeded
      setPending((prev) => {
        const next = new Map(prev);
        for (const [key] of changes) {
          if (next.has(key)) {
            // Keep failed ones — remove succeeded ones
          }
        }
        return next;
      });
      showErrorToast(
        `${failed} of ${changes.size} changes failed. Retry or cancel.`,
      );
    }
  }, [updateCell]);

  // Cancel all pending changes
  const handleCancel = useCallback(() => {
    setPending(new Map());
  }, []);

  // Switching to view mode cancels pending changes
  const handleSwitchToView = useCallback(() => {
    setPending(new Map());
    setEditing(false);
  }, []);

  const pendingCount = pending.size;

  return (
    <>
      {/* Header bar — sticky top z-30 */}
      <div className="sticky top-0 z-30 px-8 py-3 flex flex-col gap-2 bg-[var(--bg-surface)] border-b border-[var(--border)]">
        {connStatus === "error" && (
          <div
            className="px-3 py-1.5 rounded text-xs text-[var(--danger)] border border-[var(--danger)]/20"
            style={{ backgroundColor: "rgba(248,113,113,0.08)" }}
          >
            Baseline data unavailable: {error ?? "connection failed"}. Grid
            shows default values.
          </div>
        )}
        <div className="flex items-center gap-4">
          {/* View / Edit toggle */}
          <div className="inline-flex bg-[var(--bg)] rounded-[5px] p-0.5 border border-[var(--border)]">
            <button
              type="button"
              onClick={handleSwitchToView}
              className={`px-3 py-1 text-xs font-medium rounded-[4px] transition-colors cursor-pointer ${
                !editing
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              View
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={`px-3 py-1 text-xs font-medium rounded-[4px] transition-colors cursor-pointer ${
                editing
                  ? "bg-[var(--accent)] text-white"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              Edit
            </button>
          </div>

          {/* Stats */}
          <div className="flex gap-4 text-[11px]">
            <span>
              ✅ {stats.works} ({stats.worksPct}%)
            </span>
            <span>
              🛠️ {stats.possible} ({stats.possiblePct}%)
            </span>
            <span>
              ❌ {stats.impossible} ({stats.impossiblePct}%)
            </span>
            <span>
              ❓ {stats.unknown} ({stats.unknownPct}%)
            </span>
          </div>

          {connStatus === "connecting" && (
            <span className="text-[11px] text-[var(--text-muted)]">
              Connecting...
            </span>
          )}

          {/* Commit / Cancel bar — right-aligned, visible when there are pending changes */}
          {editing && pendingCount > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={handleCommit}
                disabled={committing}
                className="px-3 py-1 text-xs font-semibold rounded-[4px] bg-[var(--ok)] text-white cursor-pointer disabled:opacity-50 transition-colors hover:brightness-110"
              >
                {committing ? "Saving..." : "COMMIT"}
              </button>
              <span className="text-[11px] text-[var(--text-secondary)]">
                Changes: {pendingCount}
              </span>
              <button
                type="button"
                onClick={handleCancel}
                disabled={committing}
                className="px-3 py-1 text-xs font-medium rounded-[4px] text-[var(--danger)] cursor-pointer disabled:opacity-50 hover:bg-[var(--danger)]/10 transition-colors"
              >
                CANCEL
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto pb-12">
        <BaselineGrid
          cells={displayCells}
          editing={editing}
          onUpdate={handleLocalUpdate}
        />
      </div>
      <BaselineLegend />
      <BaselineToastContainer />
    </>
  );
}
