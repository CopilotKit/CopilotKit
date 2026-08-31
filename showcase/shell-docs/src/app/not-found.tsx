// Root-level not-found page. Required by Next.js so a thrown
// `notFound()` from any route handler yields a proper HTTP 404 response
// (not a soft-200 with a default body). Without this file, prod was
// returning 200 + Next's built-in "404: This page could not be found"
// HTML; Google read every nonexistent URL as low-quality content and
// downranked the whole site.
//
// Setting the explicit response status is the load-bearing piece. The
// rendered body is intentionally minimal — docs-shell chrome already
// wraps every page through the root layout.

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Page not found",
  description: "The page you're looking for doesn't exist.",
  robots: {
    index: false,
    follow: true,
  },
};

export default function NotFound() {
  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <p className="text-xs font-mono uppercase tracking-widest text-[var(--accent)] mb-3">
          404
        </p>
        <h1 className="text-3xl font-semibold text-[var(--text)] tracking-tight mb-3">
          This page doesn't exist
        </h1>
        <p className="text-base text-[var(--text-secondary)] leading-relaxed mb-8">
          The URL you followed may be out of date, or the page may have moved.
          Try the docs home or browse from there.
        </p>
        <div className="flex justify-center gap-3">
          <Link
            href="/"
            className="shell-docs-radius-control inline-flex h-10 items-center border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
          >
            Go to docs home
          </Link>
          <Link
            href="/reference"
            className="shell-docs-radius-control inline-flex h-10 items-center border border-[var(--border)] bg-[var(--bg-surface)] px-4 text-sm font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)]"
          >
            API reference
          </Link>
        </div>
      </div>
    </div>
  );
}
