"use client";

import { useEffect } from "react";

export default function AgUiError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ag-ui] Page render error:", error.message, error.digest);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center max-w-md">
        <h2 className="text-lg font-semibold text-[var(--text)] mb-2">
          This page has a rendering issue
        </h2>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          Some protocol documentation pages use components that are still being
          migrated. This page will be fixed shortly.
        </p>
        <p className="text-xs text-[var(--text-faint)] mb-4 font-mono">
          {error.digest || error.message}
        </p>
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
