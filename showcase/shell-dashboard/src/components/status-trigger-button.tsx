"use client";
/**
 * StatusTriggerButton — per-row [Trigger] control that opens a popover
 * with two actions: "Run all" (no scope) and "Run specific..." (opens
 * a multi-select of service slugs). Calls back via onTrigger(probeId, slugs?).
 *
 * Self-contained popover; no portal — positioned below the button via
 * relative/absolute. Closes on outside click or Escape.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface StatusTriggerButtonProps {
  probeId: string;
  serviceSlugs: string[];
  onTrigger: (probeId: string, slugs?: string[]) => Promise<void>;
}

export function StatusTriggerButton({
  probeId,
  serviceSlugs,
  onTrigger,
}: StatusTriggerButtonProps) {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement | null>(null);

  // R2-D.3: when the parent re-renders with a different slug list (e.g.
  // a probe finished and inflight transitions), drop any selected slug
  // that is no longer present. Otherwise we'd POST stale slugs the
  // parent no longer believes are in scope.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const s of prev) if (serviceSlugs.includes(s)) next.add(s);
      // Preserve identity when no change so we don't trigger a stray render.
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [serviceSlugs]);

  // R3-D.2: single close path used by outside-click, Escape, and the
  // toggle-close branch of the Trigger button. Previously the toggle-close
  // path forgot to reset pickerOpen + selected, so reopening the menu
  // showed ghost checks from a prior session — a UX inconsistency with
  // the other two close paths. Extracting a helper makes the invariant
  // ("closing the menu always resets picker state") obvious by construction.
  const closeMenu = useCallback(() => {
    setOpen(false);
    setPickerOpen(false);
    setSelected(new Set());
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        closeMenu();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeMenu();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, closeMenu]);

  // R3-D bonus: track mount so async rejections from onTrigger that resolve
  // after unmount don't trigger setState-on-unmounted-component warnings or
  // resurrect an error UI on a re-mounted instance.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Local error surface so an async rejection from onTrigger doesn't
  // bubble up as an unhandled promise rejection. R2-D.2: render the
  // error inline below the trigger so operators see fail-loud feedback
  // rather than a silent no-op.
  const [lastError, setLastError] = useState<Error | null>(null);

  const handleRunAll = async () => {
    setOpen(false);
    setPickerOpen(false);
    try {
      await onTrigger(probeId, undefined);
      if (aliveRef.current) setLastError(null);
    } catch (err) {
      if (aliveRef.current) {
        setLastError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (aliveRef.current) setSelected(new Set());
    }
  };

  const handleRunSpecific = async () => {
    if (selected.size === 0) return;
    setOpen(false);
    setPickerOpen(false);
    try {
      await onTrigger(probeId, Array.from(selected));
      if (aliveRef.current) setLastError(null);
    } catch (err) {
      if (aliveRef.current) {
        setLastError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (aliveRef.current) setSelected(new Set());
    }
  };

  const toggleSlug = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        data-testid={`status-trigger-${probeId}`}
        onClick={() => {
          // R3-D.2: when toggling closed, route through closeMenu so the
          // picker + selection state is reset, matching outside-click and
          // Escape. Toggling open is just setOpen(true).
          if (open) closeMenu();
          else setOpen(true);
        }}
        className="px-2 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--text-secondary)]"
      >
        Trigger
      </button>
      {open && (
        <div
          data-testid={`status-trigger-menu-${probeId}`}
          className="absolute right-0 z-10 mt-1 w-56 rounded border border-[var(--border)] bg-[var(--surface)] shadow-lg text-xs"
        >
          <button
            type="button"
            onClick={handleRunAll}
            className="block w-full text-left px-3 py-2 hover:bg-[var(--surface-hover)]"
          >
            Run all
          </button>
          {/*
            CR-B2.3 Option C: hide "Run specific..." entirely when no
            slugs are known. The current ProbeScheduleEntry contract
            only surfaces service slugs via inflight.services, so
            during the typical idle case (the manual-trigger case)
            we have nothing to populate the picker with. Showing an
            empty picker would be worse than offering "Run all" only.
            See CONCERNS in CR-B2 fix list — we may need a richer
            ProbeScheduleEntry contract to surface targets for idle
            probes.
          */}
          {serviceSlugs.length > 0 && (
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="block w-full text-left px-3 py-2 hover:bg-[var(--surface-hover)] border-t border-[var(--border)]"
            >
              Run specific...
            </button>
          )}
          {pickerOpen && serviceSlugs.length > 0 && (
            <div className="border-t border-[var(--border)] max-h-48 overflow-auto p-2">
              {/*
                R2-D.5: outer guard already ensures serviceSlugs.length > 0,
                so the previous `length === 0` ternary was unreachable. The
                "no slugs" case is handled by hiding "Run specific..." entirely
                in the surrounding block.
              */}
              {serviceSlugs.map((slug) => (
                <label
                  key={slug}
                  className="flex items-center gap-2 px-1 py-1 cursor-pointer hover:bg-[var(--surface-hover)]"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(slug)}
                    onChange={() => toggleSlug(slug)}
                    data-testid={`status-trigger-${probeId}-slug-${slug}`}
                  />
                  <span className="font-mono text-[11px]">{slug}</span>
                </label>
              ))}
              <button
                type="button"
                onClick={handleRunSpecific}
                disabled={selected.size === 0}
                className="mt-2 w-full px-2 py-1 text-xs rounded bg-[var(--accent)] text-white disabled:opacity-50"
              >
                Run selected ({selected.size})
              </button>
            </div>
          )}
        </div>
      )}
      {lastError && (
        <div
          data-testid="status-trigger-error"
          className="text-[11px] text-[var(--danger)] mt-1 max-w-xs"
        >
          {lastError.message}
        </div>
      )}
    </div>
  );
}
