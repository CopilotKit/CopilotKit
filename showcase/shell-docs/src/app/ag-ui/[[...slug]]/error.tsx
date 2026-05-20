"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function AgUiError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  useEffect(() => {
    // Log the full Error instance (not just .message/.digest) so the
    // stack trace reaches the server log / browser devtools. Include
    // pathname where available so reports can be tied back to a page.
    console.error(
      `[ag-ui] Page render error${pathname ? ` on ${pathname}` : ""}:`,
      error,
    );
  }, [error, pathname]);

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
