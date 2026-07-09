"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Command, Search } from "lucide-react";
import { SearchProvider, useSearchContext } from "fumadocs-ui/contexts/search";
import type {
  SearchProviderProps,
  SharedProps,
} from "fumadocs-ui/contexts/search";

import { SearchModal } from "./search-modal";

let searchOpener: HTMLElement | null = null;

function rememberSearchOpener(element: HTMLElement | null) {
  searchOpener = element;
}

function restoreSearchOpener() {
  searchOpener?.focus({ preventScroll: true });
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  ) {
    return true;
  }
  return target.isContentEditable;
}

export const SHELL_SEARCH_HOTKEY: SearchProviderProps["hotKey"] = [
  {
    key: (event) =>
      (event.metaKey || event.ctrlKey) && !isEditableTarget(event.target),
    display: "⌘/Ctrl",
  },
  {
    key: (event) => {
      const matches = event.key.toLowerCase() === "k";
      if (matches) {
        rememberSearchOpener(
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
        );
      }
      return matches;
    },
    display: "K",
  },
];

function SearchDialogAdapter({ open, onOpenChange }: SharedProps) {
  return (
    <SearchModal
      open={open}
      onOpenChange={onOpenChange}
      restoreFocus={restoreSearchOpener}
    />
  );
}

export function ShellSearchProvider({ children }: { children: ReactNode }) {
  return (
    <SearchProvider
      SearchDialog={SearchDialogAdapter}
      hotKey={SHELL_SEARCH_HOTKEY}
      preload={false}
    >
      {children}
    </SearchProvider>
  );
}

interface SearchTriggerProps {
  variant?: "full" | "icon";
}

export function SearchTrigger({ variant = "full" }: SearchTriggerProps = {}) {
  const { open, setOpenSearch } = useSearchContext();
  const [isMac, setIsMac] = useState<boolean | null>(null);

  useEffect(() => {
    const mac =
      typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);
    setIsMac(mac);
  }, []);

  const openSearch = (event: React.MouseEvent<HTMLButtonElement>) => {
    rememberSearchOpener(event.currentTarget);
    setOpenSearch(true);
  };

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={openSearch}
        aria-label="Search documentation"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Search documentation"
        className="shell-docs-radius-control flex h-11 w-11 cursor-pointer items-center justify-center border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] shadow-[var(--shadow-control)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] motion-reduce:transition-none"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={openSearch}
      aria-label="Search documentation"
      aria-haspopup="dialog"
      aria-expanded={open}
      className="shell-docs-radius-control flex h-11 w-11 cursor-pointer items-center gap-2 border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 text-[var(--text-muted)] shadow-[var(--shadow-control)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] motion-reduce:transition-none lg:w-[220px] xl:w-[260px]"
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="hidden flex-1 text-left text-sm font-medium lg:block">
        Search
      </span>
      <span
        className="shell-docs-radius-control hidden min-w-[3.25rem] items-center justify-center gap-1 border border-[var(--border)] bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-faint)] xl:inline-flex"
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
  );
}
