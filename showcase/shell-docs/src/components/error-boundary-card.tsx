"use client";

// Shared error-boundary card rendered by Next.js route-level error.tsx
// handlers. Each route (app/[[...slug]]/error.tsx, app/ag-ui/[[...slug]]/error.tsx)
// previously copy-pasted an identical component tree; this component is
// the single source of truth. Route-level error.tsx files remain
// required by Next.js (it discovers them per route segment) — they're
// now thin wrappers that forward props into this card with a log
// `scope` string so server logs / devtools can tell which route segment
// blew up.

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export interface ErrorBoundaryCardProps {
  /** Human-readable route-segment label used to tag the console.error
   * (e.g. `docs`, `ag-ui`). Prefixed onto the log line so multiple
   * nested error boundaries don't produce identical log entries. */
  scope: string;
  error: Error & { digest?: string };
  reset: () => void;
}

export function ErrorBoundaryCard({
  scope,
  error,
  reset,
}: ErrorBoundaryCardProps) {
  const pathname = usePathname();
  useEffect(() => {
    // Log the full Error instance (not just .message/.digest) so the
    // stack trace reaches the server log / browser devtools. Include
    // pathname where available so reports can be tied back to a page.
    console.error(
      `[${scope}] Page render error${pathname ? ` on ${pathname}` : ""}:`,
      error,
    );
  }, [scope, error, pathname]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center max-w-md">
        <h2 className="text-lg font-semibold text-[var(--text)] mb-2">
          Something went wrong
        </h2>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          We hit an error rendering this page. Please refresh, and if it keeps
          happening, report it with the ID below so we can track it down.
        </p>
        {error.digest && (
          <p className="text-xs text-[var(--text-faint)] mb-4 font-mono">
            Error ID: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
