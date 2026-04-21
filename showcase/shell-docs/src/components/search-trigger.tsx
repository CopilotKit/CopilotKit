"use client";

import { useState, useEffect } from "react";
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
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </button>
        {open && <SearchModalWrapper onClose={() => setOpen(false)} />}
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--text-muted)] cursor-pointer hover:border-[var(--text-faint)] transition-colors min-w-[200px]"
      >
        <span>⌕</span>
        <span>Search docs, demos...</span>
        <span
          className="ml-auto font-mono text-[10px] border border-[var(--border)] px-1 py-0.5 rounded bg-[var(--bg-surface)]"
          // Reserve horizontal room so the button doesn't reflow when the
          // shortcut hint appears after hydration.
          style={{ minWidth: "3.25rem", textAlign: "center" }}
          suppressHydrationWarning
        >
          {isMac === null ? "\u00A0" : isMac ? "⌘K" : "Ctrl+K"}
        </span>
      </button>
      {open && <SearchModalWrapper onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchModalWrapper({ onClose }: { onClose: () => void }) {
  return (
    <div data-search-modal>
      <SearchModal onClose={onClose} />
    </div>
  );
}
