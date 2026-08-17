import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";

export function V1ReferenceDeprecationNotice({ version }: { version: string }) {
  if (version !== "v1") {
    return null;
  }

  return (
    <aside
      aria-labelledby="v1-reference-deprecation-title"
      className="shell-docs-radius-surface my-5 border border-[var(--warning-border)] bg-[var(--warning-dim)] p-5 shadow-[var(--shadow-control)] md:p-6"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="shell-docs-radius-icon flex size-10 shrink-0 items-center justify-center border border-[var(--warning-border)] bg-[var(--bg-surface)] text-[var(--warning-text)] shadow-[var(--shadow-control)]">
            <TriangleAlert className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold tracking-[0.12em] text-[var(--warning-text)] uppercase">
              Legacy documentation
            </p>
            <h2
              id="v1-reference-deprecation-title"
              className="text-xl font-semibold tracking-[-0.02em] text-[var(--text)]"
            >
              CopilotKit V1 is deprecated
            </h2>
            <p className="mt-2 max-w-[65ch] text-sm leading-6 text-[var(--text-secondary)]">
              This page documents a legacy API and is no longer maintained. Use
              the V2 reference for current APIs, examples, and guidance.
            </p>
          </div>
        </div>

        <Link
          href="/reference/v2"
          className="shell-docs-radius-control inline-flex min-h-10 shrink-0 items-center justify-center gap-2 border border-[var(--accent)] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:outline-none sm:mt-6"
        >
          Go to V2 reference
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}
