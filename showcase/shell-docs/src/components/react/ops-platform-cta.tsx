"use client";

import { CopilotKitMark } from "@/components/copilotkit-mark";

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

const DEFAULT_SIGNUP_URL = "https://dashboard.operations.copilotkit.ai/";

const SIGNUP_URL =
  process.env.NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL || DEFAULT_SIGNUP_URL;

export type OpsPlatformCTAVariant = "tile" | "inline" | "card" | "info";

export interface OpsPlatformCTAProps {
  /** Visual style: tile = full-width hero, inline = mid-page callout, card = footer */
  variant?: OpsPlatformCTAVariant;
  /** Headline shown to the user */
  title: string;
  /** Body copy under the headline */
  body?: string;
  /** Stable identifier for analytics, e.g. "docs:langgraph/quickstart:whats-next".
   * Flows through to the destination URL as `utm_content` so dashboard-side
   * analytics can attribute the click. Shell-docs does not yet ship a
   * client-side PostHog capture; UTM is the source of truth here. */
  surface: string;
  /** Optional override for the link label. Defaults to "Get Intelligence free" */
  ctaLabel?: string;
  /** Optional className override for the outermost element */
  className?: string;
}

function buildHref(surface: string): string {
  const url = new URL(SIGNUP_URL);
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
  ctaLabel = "Get Intelligence free",
  className,
}: OpsPlatformCTAProps) {
  const href = buildHref(surface);

  if (variant === "info") {
    return (
      <div
        className={`not-prose my-6 flex gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4 ${className ?? ""}`}
      >
        <Info className="h-5 w-5 text-[var(--accent)] mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[var(--text)]">{title}</div>
          {body ? (
            <div className="text-sm text-[var(--text-muted)] leading-relaxed mt-1">
              {body}
            </div>
          ) : null}
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            // HubSpot's analytics tag rewrites the outbound href client-side;
            // see suppressHydrationWarning note on the card variant below.
            suppressHydrationWarning
            // Inline color wins over .reference-content .not-prose a { color: inherit }
            // in globals.css (which would otherwise drag this to the prose text color).
            style={{ color: "var(--accent)" }}
            className="inline-flex items-center gap-1 mt-2 text-sm font-medium hover:opacity-80 no-underline"
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
    // `--accent`. Inline color + textDecoration on the anchor defeat the
    // .reference-content a { text-decoration: underline; color: accent } rule
    // from globals.css that would otherwise drag the whole card to look like a
    // prose link.
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        // See suppressHydrationWarning note on the card variant below.
        suppressHydrationWarning
        data-cta-surface={surface}
        data-cta-variant={variant}
        style={{ textDecoration: "none", color: "var(--text)" }}
        className={`not-prose group relative my-6 flex flex-col gap-3 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 pl-5 transition-colors duration-150 hover:border-[var(--accent)] sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${className ?? ""}`}
      >
        {/* 2px accent stripe — the structural brand signature. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 h-full w-[2px]"
          style={{ background: "var(--accent)" }}
        />
        <div className="flex items-start gap-3 min-w-0">
          <CopilotKitMark className="mt-0.5 h-5 w-[18px] flex-shrink-0" />
          <div className="min-w-0">
            <div
              className="text-[15px] font-semibold leading-snug"
              style={{ color: "var(--text)" }}
            >
              {title}
            </div>
            {body ? (
              <div
                className="text-[13.5px] leading-relaxed mt-1"
                style={{ color: "var(--text-muted)" }}
              >
                {body}
              </div>
            ) : null}
          </div>
        </div>
        <span
          className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold"
          style={{ color: "var(--accent)" }}
        >
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
        // See suppressHydrationWarning note on the card variant below.
        suppressHydrationWarning
        data-cta-surface={surface}
        data-cta-variant={variant}
        // Inline textDecoration wins over .reference-content a { text-decoration: underline }
        // in globals.css. The Tailwind `no-underline` class loses on specificity here because
        // `not-prose` is on the <a> itself, not an ancestor — so the descendant exception
        // .reference-content .not-prose a doesn't apply.
        style={{ textDecoration: "none" }}
        className={`not-prose group flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 transition-colors duration-150 hover:border-[var(--accent)] ${className ?? ""}`}
      >
        <CopilotKitMark className="mt-0.5 h-5 w-[18px] flex-shrink-0" />
        <div>
          <div className="font-semibold text-[var(--text)] mb-1">{title}</div>
          {body ? (
            <div className="text-sm text-[var(--text-muted)] leading-relaxed">
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
  // Inline color/textDecoration defeat .reference-content a { ... } rules
  // from globals.css (same battle as the other variants).
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      // HubSpot's analytics tag rewrites the outbound href client-side to
      // append `__hstc` / `__hssc` / `__hsfp` cross-domain tracking params,
      // which trips React's hydration diff. Same fix lives on the nav-bar
      // Intelligence CTA (mobile-top-nav.tsx + brand-nav.tsx).
      suppressHydrationWarning
      data-cta-surface={surface}
      data-cta-variant={variant}
      style={{ textDecoration: "none", color: "var(--text)" }}
      className={`not-prose group relative my-8 flex flex-col items-stretch gap-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 pl-6 transition-colors duration-150 hover:border-[var(--accent)] sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-6 sm:pl-7 ${className ?? ""}`}
    >
      {/* 2px accent stripe — the structural brand signature. Positioned via the
          parent's relative + overflow-hidden so the stripe sits flush against
          the rounded corners without bleeding past them. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-full w-[2px]"
        style={{ background: "var(--accent)" }}
      />
      <div className="flex items-start gap-4 min-w-0">
        <CopilotKitMark className="mt-0.5 h-6 w-[22px] flex-shrink-0" />
        <div className="min-w-0">
          <div
            className="text-lg font-semibold leading-tight tracking-tight"
            style={{ color: "var(--text)" }}
          >
            {title}
          </div>
          {body ? (
            <div
              className="text-sm leading-relaxed mt-1.5"
              style={{ color: "var(--text-muted)" }}
            >
              {body}
            </div>
          ) : null}
        </div>
      </div>
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold flex-shrink-0"
        style={{ color: "var(--accent)" }}
      >
        {ctaLabel}
        <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
      </span>
    </a>
  );
}
