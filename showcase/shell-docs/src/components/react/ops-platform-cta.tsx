"use client";

import { CopilotKitMark } from "@/components/copilotkit-mark";
import { getRuntimeConfig } from "@/lib/runtime-config.client";
import posthog from "posthog-js";
import { useCallback } from "react";

// Icons inlined as SVG so this component avoids a lucide-react dep
// (shell-docs deliberately keeps icon usage minimal — see mdx-registry's
// emoji fallbacks for the broader icon-set decision).

function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
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

function Info({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export type OpsPlatformCTAVariant = "tile" | "inline" | "card" | "info";
export type OpsPlatformCTAAnalyticsEvent =
  | "try_for_free_clicked"
  | "talk_to_us_clicked";

export interface OpsPlatformCTAProps {
  /** Visual style: tile = full-width hero, inline = mid-page callout, card = footer */
  variant?: OpsPlatformCTAVariant;
  /** Headline shown to the user */
  title: string;
  /** Body copy under the headline */
  body?: string;
  /** Stable identifier for analytics, e.g. "docs:langgraph/quickstart:whats-next".
   * Flows through to the destination URL as `utm_content` and the PostHog
   * `location` property so CTA attribution stays consistent across docs
   * surfaces. */
  surface: string;
  /** Optional override for the link label. Defaults to "Get Enterprise Intelligence free" */
  ctaLabel?: string;
  /** Optional override for CTAs that should keep the Enterprise styling but point elsewhere. */
  href?: string;
  /** PostHog event captured on click. Defaults to the Enterprise Intelligence signup event. */
  analyticsEvent?: OpsPlatformCTAAnalyticsEvent;
  /** Optional className override for the outermost element */
  className?: string;
}

function buildHref(surface: string, hrefOverride?: string): string {
  // Signup URL is read at render time from the runtime config injected
  // by the root layout — see signup-link.tsx and lib/runtime-config.ts
  // for the full plumbing rationale. Keeps a single artifact retargetable
  // across Railway envs without rebuild. `hrefOverride` lets docs keep this
  // CTA treatment for related Enterprise actions, such as talking to an
  // engineer about self-hosting.
  const signupUrl = getRuntimeConfig().intelligenceSignupUrl;
  const url = new URL(hrefOverride ?? signupUrl);
  url.searchParams.set("utm_source", "docs");
  url.searchParams.set("utm_medium", "cta");
  url.searchParams.set("utm_campaign", "intelligence");
  url.searchParams.set("utm_content", surface);
  return url.toString();
}

export function OpsPlatformCTA({
  variant = "card",
  title,
  body,
  surface,
  ctaLabel = "Get Enterprise Intelligence free",
  href: hrefOverride,
  analyticsEvent = "try_for_free_clicked",
  className,
}: OpsPlatformCTAProps) {
  const href = buildHref(surface, hrefOverride);
  const handleClick = useCallback(() => {
    try {
      posthog.capture(analyticsEvent, { location: surface });
    } catch {
      // PostHog may be blocked by ad blockers; navigation should still work.
    }
  }, [analyticsEvent, surface]);

  if (variant === "info") {
    return (
      <div
        className={`shell-docs-radius-surface not-prose my-6 flex gap-3 border border-[var(--border)] bg-[var(--secondary)] p-4 shadow-[var(--shadow-control)] ${className ?? ""}`}
      >
        <Info className="h-5 w-5 text-[var(--brand-accent)] mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[var(--foreground)]">{title}</div>
          {body ? (
            <div className="text-sm text-[var(--muted-foreground)] leading-relaxed mt-1">
              {body}
            </div>
          ) : null}
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={handleClick}
            // HubSpot's analytics tag rewrites the outbound href client-side;
            // see suppressHydrationWarning note on the card variant below.
            suppressHydrationWarning
            className="shell-docs-cta-accent mt-2 inline-flex items-center gap-1 text-sm font-medium no-underline hover:opacity-80"
            data-cta-surface={surface}
            data-cta-variant={variant}
          >
            {ctaLabel}
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    );
  }

  if (variant === "inline") {
    // Compact sibling of the `card` variant. Same visual language — light
    // bordered surface, an accent left-edge stripe as the brand signature, the
    // CopilotKit kite as the authored stamp, and a real text-link CTA in
    // `--accent`.
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={handleClick}
        // See suppressHydrationWarning note on the card variant below.
        suppressHydrationWarning
        data-cta-surface={surface}
        data-cta-variant={variant}
        className={`shell-docs-cta-link shell-docs-radius-surface not-prose group relative my-6 flex flex-col gap-3 overflow-hidden border border-[var(--border)] bg-[var(--card)] p-4 pl-5 shadow-[var(--shadow-control)] transition-colors duration-150 hover:border-[var(--brand-accent)] sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${className ?? ""}`}
      >
        {/* 2px accent stripe — the structural brand signature. */}
        <span
          aria-hidden="true"
          className="shell-docs-cta-stripe pointer-events-none absolute left-0 top-0 h-full w-[2px]"
        />
        <div className="flex items-start gap-3 min-w-0">
          <CopilotKitMark className="mt-0.5 h-5 w-[18px] flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-snug text-[var(--foreground)]">
              {title}
            </div>
            {body ? (
              <div className="mt-1 text-[13.5px] leading-relaxed text-[var(--muted-foreground)]">
                {body}
              </div>
            ) : null}
          </div>
        </div>
        <span className="shell-docs-cta-accent inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold">
          {ctaLabel}
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
        </span>
      </a>
    );
  }

  if (variant === "tile") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={handleClick}
        // See suppressHydrationWarning note on the card variant below.
        suppressHydrationWarning
        data-cta-surface={surface}
        data-cta-variant={variant}
        className={`shell-docs-cta-link shell-docs-radius-surface not-prose group flex items-start gap-3 border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-control)] transition-colors duration-150 hover:border-[var(--brand-accent)] ${className ?? ""}`}
      >
        <CopilotKitMark className="mt-0.5 h-5 w-[18px] flex-shrink-0" />
        <div>
          <div className="font-semibold text-[var(--foreground)] mb-1">
            {title}
          </div>
          {body ? (
            <div className="text-sm text-[var(--muted-foreground)] leading-relaxed">
              {body}
            </div>
          ) : null}
        </div>
      </a>
    );
  }

  // variant === "card" (default)
  //
  // Professional inline docs CTA — Vercel/Linear/Stripe energy, not a marketing
  // splash. Light bordered surface (`--bg-surface`), a 2px accent left-edge
  // stripe as the brand signature, the CopilotKit kite as the authored stamp
  // in the corner, typography-led structure, and a real text-link CTA in
  // `--accent`. The whole tile is the anchor; the CTA text is the visible
  // click target.
  //
  // Why this design and not a filled-accent slab:
  //  - The flat-purple-block + white-pill pattern is the AI-template cliché
  //    the user has flagged twice as "vibe coded".
  //  - Real product docs CTAs (Vercel sign-up nudges, Stripe console prompts,
  //    Linear billing callouts) are mostly monochrome and typography-led, with
  //    a single accent touchpoint.
  //  - The kite reads as authored brand, far more credibly than a generic
  //    sparkle icon.
  //  - The accent stripe is the same structural cue Linear uses on important
  //    inline notices — restrained but unmistakable.
  //
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={handleClick}
      // HubSpot's analytics tag rewrites the outbound href client-side to
      // append `__hstc` / `__hssc` / `__hsfp` cross-domain tracking params,
      // which trips React's hydration diff. Same fix lives on the nav-bar
      // Intelligence CTA (mobile-top-nav.tsx + brand-nav.tsx).
      suppressHydrationWarning
      data-cta-surface={surface}
      data-cta-variant={variant}
      className={`shell-docs-cta-link shell-docs-radius-surface not-prose group relative my-8 flex flex-col items-stretch gap-4 overflow-hidden border border-[var(--border)] bg-[var(--card)] p-5 pl-6 shadow-[var(--shadow-control)] transition-colors duration-150 hover:border-[var(--brand-accent)] sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-6 sm:pl-7 ${className ?? ""}`}
    >
      {/* 2px accent stripe — the structural brand signature. Positioned via the
          parent's relative + overflow-hidden so the stripe sits flush against
          the rounded corners without bleeding past them. */}
      <span
        aria-hidden="true"
        className="shell-docs-cta-stripe pointer-events-none absolute left-0 top-0 h-full w-[2px]"
      />
      <div className="flex items-start gap-4 min-w-0">
        <CopilotKitMark className="mt-0.5 h-6 w-[22px] flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-lg font-semibold leading-tight tracking-tight text-[var(--foreground)]">
            {title}
          </div>
          {body ? (
            <div className="mt-1.5 text-sm leading-relaxed text-[var(--muted-foreground)]">
              {body}
            </div>
          ) : null}
        </div>
      </div>
      <span className="shell-docs-cta-accent inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-semibold">
        {ctaLabel}
        <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
      </span>
    </a>
  );
}
