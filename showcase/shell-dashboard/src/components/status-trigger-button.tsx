"use client";
/**
 * StatusTriggerButton — per-row [Trigger] control that opens a popover
 * with two actions: "Run all" (no scope) and "Run specific..." (opens
 * a multi-select of service slugs). Calls back via onTrigger(probeId, slugs?).
 *
 * Self-contained popover; no portal — positioned below the button via
 * relative/absolute. Closes on outside click or Escape.
 */
import { useEffect, useRef, useState } from "react";

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

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setPickerOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleRunAll = async () => {
    setOpen(false);
    setPickerOpen(false);
    await onTrigger(probeId, undefined);
  };

  const handleRunSpecific = async () => {
    if (selected.size === 0) return;
    setOpen(false);
    setPickerOpen(false);
    await onTrigger(probeId, Array.from(selected));
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
        onClick={() => setOpen((v) => !v)}
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
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="block w-full text-left px-3 py-2 hover:bg-[var(--surface-hover)] border-t border-[var(--border)]"
          >
            Run specific...
          </button>
          {pickerOpen && (
            <div className="border-t border-[var(--border)] max-h-48 overflow-auto p-2">
              {serviceSlugs.length === 0 ? (
                <div className="text-[var(--text-muted)] px-1 py-1">
                  No services
                </div>
              ) : (
                serviceSlugs.map((slug) => (
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
                ))
              )}
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
    </div>
  );
}
