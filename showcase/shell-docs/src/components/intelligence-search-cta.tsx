"use client";

// The curated Intelligence recommendation that sits above the docs
// search result list. See lib/intelligence-search-ctas.ts for the data
// and the matching rules; this file is only presentation, selection and
// attribution.
//
// Visual language is inherited from react/ops-platform-cta.tsx — the 2px
// accent left-edge stripe, the CopilotKit kite as the authored stamp,
// --bg-surface / --border / --accent, shell-docs-radius-surface, and an
// accent text CTA with an arrow. It is deliberately NOT the marketing
// slab: a search row has far tighter geometry, so the type scale is the
// modal's own and the padding matches a result row rather than a
// mid-article callout. What keeps it visibly distinct from an organic
// result row is the border, the stripe, the kite and the "Recommended"
// eyebrow; every colour comes from a theme token so it reads correctly
// in light and dark.
//
// Accessibility: the block is a labelled `group`, NOT an option in the
// search-results listbox, so assistive technology announces it as a
// recommendation rather than as a fourteenth result. The primary link
// carries the id the search input points aria-activedescendant at, and
// its accessible name repeats the recommendation framing so a reader
// arrowing onto it hears what kind of thing they landed on.
//
// The whole card activates the primary destination. Every link here is a
// real anchor with a real, already-attributed href — so focus, middle-click
// and open-in-new-tab all behave — and the primary one grows a pseudo-
// element overlay across the card rather than wrapping the secondary links,
// which would be invalid nested-anchor markup.

import posthog from "posthog-js";
import { useCallback } from "react";

import { CopilotKitMark } from "@/components/copilotkit-mark";
import {
  buildTrackedInternalDocsHref,
  intelligenceSearchCtaSurface,
  matchedKeywordFor,
} from "@/lib/intelligence-search-ctas";
import type { IntelligenceSearchCta } from "@/lib/intelligence-search-ctas";

function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export interface IntelligenceSearchCtaAttribution {
  /** Frontend the docs route is scoped to. */
  frontend?: string;
  /** Agent backend the docs route is scoped to. */
  backend?: string;
}

/**
 * Records the click and hands the attributed, root-relative href back to
 * the caller's navigation function.
 *
 * Shared by the block's own links and by the modal's Enter handler so
 * both paths report identically — a keyboard activation must not be
 * invisible in the funnel just because no mouse was involved.
 */
export function activateIntelligenceSearchCta({
  cta,
  query,
  destination,
  attribution,
  navigate,
}: {
  cta: IntelligenceSearchCta;
  query: string;
  destination: string;
  attribution: IntelligenceSearchCtaAttribution;
  navigate: (href: string) => void;
}): void {
  const matchedKeyword = matchedKeywordFor(cta, query);
  const surface = intelligenceSearchCtaSurface(cta.id, matchedKeyword);
  const href = buildTrackedInternalDocsHref(destination, {
    surface,
    ...attribution,
  });

  try {
    posthog.capture("docs_conversion_clicked", {
      surface,
      location: surface,
      destination: href,
      cta_id: cta.id,
      // The matched KEYWORD, never the raw query — the reader's typed
      // text is not ours to ship to analytics.
      matched_keyword: matchedKeyword,
    });
  } catch {
    // PostHog is routinely blocked by ad blockers; navigation must still
    // work. Same guard as ops-platform-cta.tsx.
  }

  navigate(href);
}

export interface IntelligenceSearchCtaBlockProps {
  cta: IntelligenceSearchCta;
  /** The reader's raw query — used only to report which keyword fired. */
  query: string;
  /** DOM id of the block itself, so the search input can aria-control it. */
  groupId: string;
  /** DOM id the search input points aria-activedescendant at. */
  optionId: string;
  /** True while this block is the keyboard selection. */
  selected: boolean;
  /** Keeps hover and keyboard selection in sync, exactly as result rows do. */
  onHover: () => void;
  /**
   * Internal navigation. Must be the modal's own navigateTo so
   * client-side routing and modal-close behaviour match result rows.
   */
  onNavigate: (href: string) => void;
  attribution: IntelligenceSearchCtaAttribution;
}

/**
 * True for the clicks the browser must own: middle-click, cmd/ctrl-click,
 * shift-click and alt-click. Intercepting those would break "open in a new
 * tab", which is the reason the primary action is a real anchor with a real
 * href rather than a button.
 */
function isBrowserOwnedClick(event: React.MouseEvent): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

export function IntelligenceSearchCtaBlock({
  cta,
  query,
  groupId,
  optionId,
  selected,
  onHover,
  onNavigate,
  attribution,
}: IntelligenceSearchCtaBlockProps) {
  const surface = intelligenceSearchCtaSurface(
    cta.id,
    matchedKeywordFor(cta, query),
  );

  const go = useCallback(
    (destination: string) => {
      activateIntelligenceSearchCta({
        cta,
        query,
        destination,
        attribution,
        navigate: onNavigate,
      });
    },
    [attribution, cta, onNavigate, query],
  );

  /**
   * The attributed href an anchor carries. Identical to the destination
   * `activateIntelligenceSearchCta` navigates to, so a reader who opens the
   * link in a new tab lands on exactly the same attributed URL as one who
   * clicks it normally.
   */
  const hrefFor = useCallback(
    (destination: string) =>
      buildTrackedInternalDocsHref(destination, { surface, ...attribution }),
    [attribution, surface],
  );

  const clickHandlerFor = useCallback(
    (destination: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (isBrowserOwnedClick(event)) {
        // Still report the click, but let the browser follow the href —
        // the no-op navigate keeps the funnel honest without stealing the
        // new tab from the reader.
        activateIntelligenceSearchCta({
          cta,
          query,
          destination,
          attribution,
          navigate: () => {},
        });
        return;
      }
      event.preventDefault();
      go(destination);
    },
    [attribution, cta, go, query],
  );

  return (
    <div
      id={groupId}
      role="group"
      aria-label="Recommended guide"
      onMouseEnter={onHover}
      data-cta-surface={surface}
      className="border-b border-[var(--border)] p-2"
    >
      <div
        className={`shell-docs-radius-surface relative overflow-hidden border bg-[var(--bg-surface)] px-3 py-3 pl-4 transition-colors ${
          selected
            ? "border-[var(--accent)] bg-[var(--bg-elevated)]"
            : "border-[var(--border)]"
        }`}
      >
        {/* 2px accent stripe — the structural brand signature shared with
            the in-page Intelligence CTAs. */}
        <span
          aria-hidden="true"
          className="shell-docs-cta-stripe pointer-events-none absolute left-0 top-0 h-full w-[2px]"
        />
        <div className="flex min-w-0 items-start gap-3">
          <CopilotKitMark className="mt-0.5 h-[18px] w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-wide text-[var(--accent)]">
              Recommended
            </div>
            <div className="mt-0.5 text-[13px] font-semibold leading-snug text-[var(--text)]">
              {cta.title}
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">
              {cta.body}
            </div>
            {/* Card-link overlay: the `after:` pseudo-element stretches the
                primary anchor's hit area across the whole card, so a click
                anywhere on the block goes to the primary destination.
                Nesting the secondary links inside this anchor would be
                invalid HTML, so they stay siblings and are lifted above the
                overlay below. The accepted cost is that text inside the
                card is no longer selectable. */}
            <a
              id={optionId}
              href={hrefFor(cta.primary.href)}
              // Repeats the framing so a reader who arrows onto this from
              // the search input hears "recommendation", not just a label.
              aria-label={`Recommended: ${cta.title}. ${cta.primary.label}`}
              onClick={clickHandlerFor(cta.primary.href)}
              className="mt-2 inline-flex cursor-pointer items-center gap-1 text-[12px] font-semibold text-[var(--accent)] no-underline transition-opacity after:absolute after:inset-0 after:z-0 after:content-[''] hover:opacity-80"
            >
              {cta.primary.label}
              <ArrowRight className="h-3.5 w-3.5" />
            </a>
            {/* Positioned and stacked above the overlay so each secondary
                link's own click wins over the card-wide primary one. */}
            <div className="relative z-10 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              {cta.secondary.map((link) => (
                <a
                  key={link.href}
                  href={hrefFor(link.href)}
                  onClick={clickHandlerFor(link.href)}
                  className="cursor-pointer text-[11px] text-[var(--text-muted)] underline decoration-[var(--border)] underline-offset-2 transition-colors hover:text-[var(--text)] hover:decoration-[var(--accent)]"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
