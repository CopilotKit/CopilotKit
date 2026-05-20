"use client";

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

function Sparkles({ className }: { className?: string }) {
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
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
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
    return (
      <div
        className={`not-prose my-6 flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--violet-light)] p-4 sm:flex-row sm:items-center sm:justify-between ${className ?? ""}`}
      >
        <div className="flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-[var(--accent)] mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-semibold text-[var(--text)]">{title}</div>
            {body ? (
              <div className="text-sm text-[var(--text-muted)] leading-relaxed mt-0.5">
                {body}
              </div>
            ) : null}
          </div>
        </div>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          // Inline color wins over .reference-content .not-prose a { color: inherit }
          // in globals.css (which would otherwise leave this dark on the violet button).
          style={{ color: "#ffffff" }}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-[var(--accent)] hover:opacity-90 text-sm font-medium px-4 py-2 no-underline transition-opacity"
          data-cta-surface={surface}
          data-cta-variant={variant}
        >
          {ctaLabel}
          <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    );
  }

  if (variant === "tile") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        data-cta-surface={surface}
        data-cta-variant={variant}
        // Inline textDecoration wins over .reference-content a { text-decoration: underline }
        // in globals.css. The Tailwind `no-underline` class loses on specificity here because
        // `not-prose` is on the <a> itself, not an ancestor — so the descendant exception
        // .reference-content .not-prose a doesn't apply.
        style={{ textDecoration: "none" }}
        className={`not-prose group flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--violet-light)] p-4 shadow-sm hover:border-[var(--accent)] transition-colors ${className ?? ""}`}
      >
        <Sparkles className="h-5 w-5 text-[var(--accent)] mt-0.5 flex-shrink-0" />
        <div>
          <div className="font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
            {title}
          </div>
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
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-cta-surface={surface}
      data-cta-variant={variant}
      // See note on the tile variant — inline textDecoration is needed to defeat
      // .reference-content a { text-decoration: underline } from globals.css.
      style={{ textDecoration: "none" }}
      className={`not-prose my-8 flex items-center justify-between gap-4 rounded-lg border border-[var(--border)] bg-[var(--violet-light)] p-5 shadow-sm hover:border-[var(--accent)] transition-colors ${className ?? ""}`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <Sparkles className="h-5 w-5 text-[var(--accent)] mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <div className="font-semibold text-[var(--text)] mb-1">{title}</div>
          {body ? (
            <div className="text-sm text-[var(--text-muted)] leading-relaxed">
              {body}
            </div>
          ) : null}
        </div>
      </div>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-[var(--accent)]">
        {ctaLabel}
        <ArrowRight className="h-4 w-4" />
      </span>
    </a>
  );
}
