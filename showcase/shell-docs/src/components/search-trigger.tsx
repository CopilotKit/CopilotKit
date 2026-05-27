"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Command, Search } from "lucide-react";
import { SearchModal } from "./search-modal";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function SearchTrigger({
  iconOnly = false,
}: { iconOnly?: boolean } = {}) {
  // Start as null so SSR output matches the initial client render; resolve
  // after mount to avoid hydration mismatch flashing ⌘K → Ctrl+K on non-Mac.
  const [isMac, setIsMac] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const mac =
      typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);
    setIsMac(mac);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        // Don't hijack Cmd/Ctrl+K when the user is typing in an unrelated
        // input / textarea / contenteditable — only steal the shortcut when
        // focus is outside an editable element or already inside our own
        // search modal.
        const target = e.target as HTMLElement | null;
        const insideSearchModal =
          target?.closest?.("[data-search-modal]") != null;
        if (isEditableTarget(target) && !insideSearchModal) return;

        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  if (iconOnly) {
    return (
      <>
        <button
          onClick={() => setOpen((prev) => !prev)}
          className="flex items-center justify-center w-8 h-8 rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
          aria-label="Search"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </button>
        {open && <SearchModalWrapper onClose={() => setOpen(false)} />}
      </>
    );
  }

  // Mirrors the canonical `search-button.tsx` chrome: same height as the
  // navbar's right-cluster controls, icon + label on lg+, ⌘K hint on xl+.
  return (
    <>
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Search"
        className="lg:min-w-[250px] xl:min-w-[300px] flex gap-2 items-center px-3 h-10 rounded-xl cursor-pointer border border-[var(--border)] bg-[var(--bg-elevated)]/70 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition-colors shadow-[0_1px_0_rgba(1,5,7,0.03)]"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />

        <span className="hidden flex-1 text-left text-sm font-medium lg:block">
          Search
        </span>

        <span
          className="hidden xl:inline-flex items-center justify-center gap-1 font-mono text-[11px] border border-[var(--border)] px-1.5 py-0.5 rounded-md text-[var(--text-faint)] bg-[var(--bg-surface)]"
          // Reserve horizontal room so the button doesn't reflow when the
          // shortcut hint appears after hydration.
          style={{ minWidth: "3.25rem" }}
          suppressHydrationWarning
        >
          {isMac === null ? (
            "\u00a0"
          ) : isMac ? (
            <>
              <Command className="h-3 w-3" aria-hidden="true" />K
            </>
          ) : (
            "Ctrl K"
          )}
        </span>
      </button>
      {open && <SearchModalWrapper onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchModalWrapper({ onClose }: { onClose: () => void }) {
  // Portal to document.body so the modal's `position: fixed` resolves
  // against the viewport. The trigger renders inside the navbar's right
  // cluster, which uses `backdrop-blur-lg` — backdrop-filter creates a
  // containing block for fixed-position descendants, which would
  // otherwise clamp the overlay to the cluster's bounding rect instead
  // of covering the page.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div data-search-modal>
      <SearchModal onClose={onClose} />
    </div>,
    document.body,
  );
}
