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

import React, { useEffect, useState } from "react";
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
 * Wrap MDX body so it only renders when the user has no framework to
 * land on. On `/docs/<feature>`:
 *   - URL has a framework → impossible (handled by a framework-scoped
 *     route, not this one).
 *   - User has a storedFramework → they're about to be redirected by
 *     RouterPivot; hide the body to avoid flashing docs that will be
 *     replaced in a tick.
 *   - Neither → render the body so the user sees the pivot + any MDX
 *     copy that accompanies it.
 *
 * Hydration-flash guard: `storedFramework` is always null on the first
 * render (localStorage is read in a mount effect). Without the
 * `hasHydrated` gate below, a returning user who picked LangChain
 * would briefly see the MDX body render, then disappear as the
 * effect reads localStorage and flips `storedFramework` from null to
 * "langgraph-python". The gate holds the body back until the first
 * mount effect has run, swallowing that flash. Fresh visitors (who
 * legitimately have null stored) see the content on the next tick;
 * the delay is one microtask and invisible in practice.
 *
 * Covered by: visit /docs/foo with no localStorage entry → MDX body
 * visible alongside the pivot; visit with localStorage=langgraph-python
 * → NO flash of docs body while redirect runs.
 */
export function FrameworkGuardedContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const { framework, storedFramework } = useFramework();
  const [hasHydrated, setHasHydrated] = useState(false);
  useEffect(() => {
    setHasHydrated(true);
  }, []);
  // Before hydration, suppress — we don't yet know whether a stored
  // framework exists, and rendering content we're about to hide
  // causes a visible flash. After hydration, apply the normal rule:
  // hide only when we're about to redirect to a framework-scoped
  // page. When neither exists we want the pivot + MDX body.
  if (!hasHydrated) return null;
  if (framework || storedFramework) return null;
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
  const { framework, storedFramework } = useFramework();
  const [hasHydrated, setHasHydrated] = useState(false);
  useEffect(() => {
    setHasHydrated(true);
  }, []);

  // Redirect target: prefer URL framework (should never happen on
  // `/docs/*` since that route prefix isn't a known framework, but we
  // still honour it if a future route passes us a framework-scoped
  // URL), then fall back to the user's stored preference.
  //
  // NOTE: this used to read `framework` only, which on `/docs/*` is
  // always null because the URL prefix `docs` is never in
  // `knownFrameworks`. That silently broke the "picked-once, sticks"
  // feature — users with a stored preference never got redirected.
  //
  // Covered by: visit /docs/<feature> with localStorage set → redirected
  // to /<framework>/<feature>; visit with no localStorage → pivot grid
  // rendered.
  const target = framework ?? storedFramework;

  useEffect(() => {
    if (target) {
      router.replace(`/${target}/${slugPath}`);
    }
  }, [target, router, slugPath]);

  // Hydration-flash guard: `storedFramework` is null on the very first
  // render (populated by a mount effect in FrameworkProvider). Without
  // this gate, returning users see the full pivot grid render, then
  // have it replaced by the "Loading …" placeholder one tick later as
  // storedFramework flips from null to their stored slug.
  //
  // Covered by: returning user with localStorage=langgraph-python visits
  // /docs/<feature> → sees the loading placeholder immediately, not a
  // flash of the pivot grid.
  if (!hasHydrated) {
    return (
      <div className="text-xs text-[var(--text-muted)]">Loading…</div>
    );
  }

  // If we have a redirect target we'll be redirected in a tick —
  // render a lightweight placeholder instead of the full pivot to
  // avoid flashing the grid at the user.
  if (target) {
    return (
      <div className="text-xs text-[var(--text-muted)]">
        Loading {target} view…
      </div>
    );
  }

  const withCell = new Set(frameworksWithCell ?? []);

  // Promote frameworks that are deployed AND have a cell tagged for
  // this feature. Deployed frameworks without a cell are shown under
  // "coming soon". Undeployed frameworks are omitted entirely —
  // surfacing them in either bucket would point users at a dead link.
  const supported = options.filter((o) => o.deployed && withCell.has(o.slug));
  const unsupported = options.filter(
    (o) => o.deployed && !withCell.has(o.slug),
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
