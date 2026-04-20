"use client";

// RouterPivot — client-side "pick an agentic backend" UI rendered at
// the top of every `/docs/<feature>` page. When a framework is already
// selected (via URL or localStorage) we auto-redirect the user to
// `/<framework>/<feature>`; when none is selected we show a grid of
// integration cards that link to the framework-scoped equivalent.
//
// The MDX body for the page is also conditionally hidden when no
// framework is selected — the router-page's job is to pivot, not to
// serve code without the relevant backend context.

import React, { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFramework } from "./framework-provider";
import type { FrameworkOption } from "./framework-selector";

export interface RouterPivotProps {
  /** Slug path (no leading slash). */
  slugPath: string;
  /** All framework options, pre-sorted by preference. */
  options: FrameworkOption[];
  /**
   * Subset of framework slugs that have a cell tagged for this
   * feature — those are highlighted/promoted. Frameworks without a
   * cell are rendered dim/disabled with a "coming soon" label.
   */
  frameworksWithCell?: string[];
  /** Optional preview (gif / mp4) URL for the feature. */
  previewUrl?: string | null;
  /** Feature display name (e.g. "Tool Rendering"). */
  featureName?: string;
  /** Short feature description. */
  featureDescription?: string;
}

/**
 * Wrap MDX body so it only renders when a framework is selected.
 * On `/docs/<feature>` we don't show code — the user hasn't told us
 * which backend to render it for.
 */
export function FrameworkGuardedContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const { framework } = useFramework();
  if (!framework) return null;
  return <>{children}</>;
}

export function RouterPivot({
  slugPath,
  options,
  frameworksWithCell,
  previewUrl,
  featureName,
  featureDescription,
}: RouterPivotProps) {
  const router = useRouter();
  const { framework } = useFramework();

  // When the user arrives on `/docs/<feature>` but already has a
  // framework preference stored, skip the pivot and jump straight to
  // the framework-scoped page. This preserves the "picked-once, sticks"
  // behaviour across visits.
  useEffect(() => {
    if (framework) {
      router.replace(`/${framework}/${slugPath}`);
    }
  }, [framework, router, slugPath]);

  // If the provider already knows a framework we'll be redirected in a
  // tick — render a lightweight placeholder instead of the full pivot
  // to avoid flashing the grid at the user.
  if (framework) {
    return (
      <div className="text-xs text-[var(--text-muted)]">
        Loading {framework} view…
      </div>
    );
  }

  const withCell = new Set(frameworksWithCell ?? []);

  // Promote frameworks that have the cell tagged; everything else is
  // shown below as "coming soon".
  const supported = options.filter((o) => withCell.has(o.slug));
  const unsupported = options.filter(
    (o) => !withCell.has(o.slug) && o.deployed,
  );

  return (
    <div className="space-y-6">
      {/* Hero block */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
        <div className="px-6 py-5">
          {featureName && (
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)] mb-2">
              Feature
            </div>
          )}
          <h2 className="text-xl font-semibold text-[var(--text)] mb-2">
            {featureName ?? "This feature"}
          </h2>
          {featureDescription && (
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {featureDescription}
            </p>
          )}
        </div>
        {previewUrl && (
          <div className="border-t border-[var(--border)] bg-[var(--bg-elevated)]">
            {previewUrl.endsWith(".mp4") ? (
              <video
                src={previewUrl}
                className="w-full"
                autoPlay
                muted
                loop
                playsInline
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt=""
                className="w-full block"
                loading="lazy"
              />
            )}
          </div>
        )}
      </div>

      {/* Pivot CTA */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)] mb-2">
          Step 1
        </div>
        <h3 className="text-lg font-semibold text-[var(--text)] mb-1">
          Pick an agentic backend to see the implementation
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-4">
          Every integration ships a live cell wired to these docs. Choose your
          backend and the rest of the page will render against that
          framework&apos;s code.
        </p>

        {supported.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-6">
            {supported.map((opt) => (
              <Link
                key={opt.slug}
                href={`/${opt.slug}/${slugPath}`}
                className="group flex items-center gap-2 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] hover:shadow-sm transition-all"
              >
                {opt.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={opt.logo} alt="" className="w-5 h-5 shrink-0" />
                ) : (
                  <span className="w-5 h-5 shrink-0" />
                )}
                <span className="text-sm font-medium text-[var(--text)] group-hover:text-[var(--accent)] truncate">
                  {opt.name}
                </span>
              </Link>
            ))}
          </div>
        )}

        {unsupported.length > 0 && (
          <details className="text-sm text-[var(--text-muted)]">
            <summary className="cursor-pointer hover:text-[var(--text-secondary)]">
              Other frameworks ({unsupported.length}) — not yet tagged for this
              feature
            </summary>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
              {unsupported.map((opt) => (
                <Link
                  key={opt.slug}
                  href={`/${opt.slug}/${slugPath}`}
                  className="group flex items-center gap-2 p-2 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--text-muted)] transition-all"
                >
                  {opt.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={opt.logo} alt="" className="w-4 h-4 shrink-0" />
                  ) : (
                    <span className="w-4 h-4 shrink-0" />
                  )}
                  <span className="text-xs text-[var(--text-secondary)] truncate">
                    {opt.name}
                  </span>
                </Link>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
