"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
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

  // Mirrors the canonical `search-button.tsx` chrome: same height as the
  // navbar's right-cluster controls, icon + label on lg+, ⌘K hint on xl+.
  return (
    <>
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Search"
        className="-ml-2 lg:ml-0 lg:min-w-[260px] xl:min-w-[320px] flex gap-2 items-center px-3 h-11 rounded-lg cursor-pointer bg-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M9.16667 15.8333C12.8486 15.8333 15.8333 12.8486 15.8333 9.16667C15.8333 5.48477 12.8486 2.5 9.16667 2.5C5.48477 2.5 2.5 5.48477 2.5 9.16667C2.5 12.8486 5.48477 15.8333 9.16667 15.8333Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M17.5 17.5L13.875 13.875"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <span className="hidden flex-1 text-left text-sm font-medium lg:block">
          Search...
        </span>

        <span
          className="hidden xl:inline-flex items-center justify-center font-mono text-[11px] border border-[var(--border)] px-1.5 py-0.5 rounded text-[var(--text-faint)] bg-[var(--bg-surface)]"
          // Reserve horizontal room so the button doesn't reflow when the
          // shortcut hint appears after hydration.
          style={{ minWidth: "2.5rem" }}
          suppressHydrationWarning
        >
          {isMac === null ? " " : isMac ? "⌘K" : "Ctrl+K"}
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
