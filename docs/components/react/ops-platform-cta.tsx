"use client";

import { ArrowRight, Info, Sparkles } from "lucide-react";
import posthog from "posthog-js";
import { useCallback } from "react";

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
  /** Stable identifier for analytics, e.g. "docs:langgraph/quickstart:whats-next" */
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
  const handleClick = useCallback(() => {
    try {
      posthog.capture("try_for_free_clicked", { location: surface });
    } catch {
      // PostHog may be blocked by ad blockers — never let analytics block navigation.
    }
  }, [surface]);

  const href = buildHref(surface);

  if (variant === "info") {
    return (
      <div
        className={`not-prose my-6 flex gap-3 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/30 p-4 ${className ?? ""}`}
      >
        <Info className="h-5 w-5 text-blue-600 dark:text-blue-300 mt-0.5 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-foreground">{title}</div>
          {body ? (
            <div className="text-sm text-muted-foreground leading-relaxed mt-1">
              {body}
            </div>
          ) : null}
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={handleClick}
            className="inline-flex items-center gap-1 mt-2 text-sm font-medium text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 no-underline"
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
        className={`not-prose my-6 flex flex-col gap-3 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/40 dark:to-purple-950/40 p-4 sm:flex-row sm:items-center sm:justify-between ${className ?? ""}`}
      >
        <div className="flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-300 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-semibold text-foreground">{title}</div>
            {body ? (
              <div className="text-sm text-muted-foreground leading-relaxed mt-0.5">
                {body}
              </div>
            ) : null}
          </div>
        </div>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          onClick={handleClick}
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 no-underline transition-colors"
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
        onClick={handleClick}
        data-cta-surface={surface}
        data-cta-variant={variant}
        className={`not-prose group flex items-start gap-3 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950/40 dark:to-purple-950/40 p-4 no-underline shadow-sm hover:border-indigo-400 dark:hover:border-indigo-700 transition-colors ${className ?? ""}`}
      >
        <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-300 mt-0.5 flex-shrink-0" />
        <div>
          <div className="font-semibold text-foreground group-hover:text-indigo-700 dark:group-hover:text-indigo-200 mb-1">
            {title}
          </div>
          {body ? (
            <div className="text-sm text-muted-foreground leading-relaxed">
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
      onClick={handleClick}
      data-cta-surface={surface}
      data-cta-variant={variant}
      className={`not-prose my-8 flex items-center justify-between gap-4 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/40 dark:to-purple-950/40 p-5 no-underline shadow-sm hover:border-indigo-400 dark:hover:border-indigo-700 transition-colors ${className ?? ""}`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-300 mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <div className="font-semibold text-foreground mb-1">{title}</div>
          {body ? (
            <div className="text-sm text-muted-foreground leading-relaxed">
              {body}
            </div>
          ) : null}
        </div>
      </div>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-indigo-700 dark:text-indigo-200">
        {ctaLabel}
        <ArrowRight className="h-4 w-4" />
      </span>
    </a>
  );
}
