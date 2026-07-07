"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Command, Search } from "lucide-react";
import { SearchModal } from "./search-modal";

const TOGGLE_SEARCH_EVENT = "shell-docs:toggle-search";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function ShellSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const closeSearch = useCallback(() => setOpen(false), []);
  const toggleSearch = useCallback(() => setOpen((prev) => !prev), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // Don't hijack Cmd/Ctrl+K when the user is typing in an unrelated
        // input / textarea / contenteditable — only steal the shortcut when
        // focus is outside an editable element or already inside our own
        // search modal.
        const target = e.target as HTMLElement | null;
        const insideSearchModal =
          target?.closest?.("[data-search-modal]") != null;
        if (isEditableTarget(target) && !insideSearchModal) return;

        e.preventDefault();
        e.stopPropagation();
        toggleSearch();
      }
      if (e.key === "Escape") closeSearch();
    }

    document.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener(TOGGLE_SEARCH_EVENT, toggleSearch);

    return () => {
      document.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener(TOGGLE_SEARCH_EVENT, toggleSearch);
    };
  }, [closeSearch, toggleSearch]);

  return (
    <>
      {children}
      {open && <SearchModalWrapper onClose={closeSearch} />}
    </>
  );
}

function toggleShellSearch() {
  window.dispatchEvent(new Event(TOGGLE_SEARCH_EVENT));
}

export function SearchTrigger({
  iconOnly = false,
}: { iconOnly?: boolean } = {}) {
  // Start as null so SSR output matches the initial client render; resolve
  // after mount to avoid hydration mismatch flashing ⌘K → Ctrl+K on non-Mac.
  const [isMac, setIsMac] = useState<boolean | null>(null);

  useEffect(() => {
    const mac =
      typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);
    setIsMac(mac);
  }, []);

  if (iconOnly) {
    return (
      <button
        onClick={toggleShellSearch}
        className="shell-docs-radius-control flex h-10 w-10 cursor-pointer items-center justify-center border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] shadow-[var(--shadow-control)] transition-colors hover:border-[var(--brand-accent)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        aria-label="Search"
        title="Search"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  // Mirrors the canonical `search-button.tsx` chrome: same height as the
  // navbar's right-cluster controls, icon + label on lg+, ⌘K hint on xl+.
  return (
    <>
      <button
        onClick={toggleShellSearch}
        aria-label="Search"
        className="shell-docs-radius-control flex h-10 w-10 cursor-pointer items-center gap-2 border border-[var(--border)] bg-[var(--card)] px-2.5 text-[var(--muted-foreground)] shadow-[var(--shadow-control)] transition-colors hover:border-[var(--brand-accent)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)] lg:w-[220px] xl:w-[260px]"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />

        <span className="hidden flex-1 text-left text-sm font-medium lg:block">
          Search
        </span>

        <span
          className="shell-docs-radius-control hidden min-w-[3.25rem] items-center justify-center gap-1 border border-[var(--border)] bg-[var(--card)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--muted-foreground)] xl:inline-flex"
          // Reserve horizontal room so the button doesn't reflow when the
          // shortcut hint appears after hydration.
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
