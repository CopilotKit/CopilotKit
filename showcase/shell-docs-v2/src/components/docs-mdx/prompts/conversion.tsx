"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Callout } from "fumadocs-ui/components/callout";
import { trackEvent } from "@/lib/telemetry/analytics";
import type { DocsScope } from "../scope";
import { CtaCardBody, ctaCardClass } from "./cta-card";
import { usePageStack } from "./page-stack";

// The docs' conversion links, with shell-docs' URLs, UTM parameters and
// PostHog events (react/ops-platform-cta.tsx, react/signup-link.tsx,
// react/docs-conversion.tsx, lib/docs-cta-href.ts).

/** Where CopilotKit Intelligence sign-up starts (shell-docs' production default). */
export const INTELLIGENCE_SIGNUP_URL = "https://dashboard.operations.copilotkit.ai/";

interface DocsCtaAttribution {
  surface: string;
  frontend?: string;
  backend?: string;
}

function addDocsCtaAttribution(
  url: URL,
  { surface, frontend, backend }: DocsCtaAttribution,
): string {
  url.searchParams.set("utm_source", "docs");
  url.searchParams.set("utm_medium", "cta");
  url.searchParams.set("utm_campaign", "intelligence");
  url.searchParams.set("utm_content", surface);
  if (frontend) url.searchParams.set("utm_frontend", frontend);
  if (backend) url.searchParams.set("utm_backend", backend);
  return url.toString();
}

/** The Intelligence sign-in entry, returning the reader to onboarding. */
export function buildIntelligenceAuthEntryHref(
  attribution: DocsCtaAttribution,
): string {
  const url = new URL("/sign-in", INTELLIGENCE_SIGNUP_URL);
  url.searchParams.set("post_auth_redirect", "ready");
  return addDocsCtaAttribution(url, attribution);
}

/** Any absolute destination, with the docs' CTA attribution. */
export function buildTrackedDocsHref(
  destination: string,
  attribution: DocsCtaAttribution,
): string {
  try {
    return addDocsCtaAttribution(new URL(destination), attribution);
  } catch {
    return destination;
  }
}

/** The stack and page a CTA reports: explicit props win over the page's. */
function useAttribution(
  scope: DocsScope,
  props: { frontend?: string; backend?: string; fromPath?: string },
) {
  const stack = usePageStack(scope);
  return {
    frontend: props.frontend ?? stack.frontend,
    backend: props.backend ?? stack.framework ?? undefined,
    fromPath: props.fromPath ?? stack.pathname,
  };
}

export type OpsPlatformCTAVariant = "tile" | "inline" | "card" | "info";

export interface OpsPlatformCTAProps {
  scope: DocsScope;
  /** tile = compact link card, inline = mid-page callout, card = footer, info = callout */
  variant?: OpsPlatformCTAVariant;
  title: string;
  body?: string;
  /** Stable analytics id; becomes `utm_content` and the event's `location`. */
  surface: string;
  ctaLabel?: string;
  /** Keep the CTA's look but send it somewhere else (e.g. talk to an engineer). */
  href?: string;
  analyticsEvent?: "try_for_free_clicked" | "talk_to_us_clicked";
  frontend?: string;
  backend?: string;
  fromPath?: string;
  className?: string;
}

/** CopilotKit Intelligence call to action (shell-docs' `OpsPlatformCTA`). */
export function OpsPlatformCTA({
  scope,
  variant = "card",
  title,
  body,
  surface,
  ctaLabel = "Get CopilotKit Intelligence free",
  href: hrefOverride,
  analyticsEvent = "try_for_free_clicked",
  className,
  ...props
}: OpsPlatformCTAProps) {
  const { frontend, backend, fromPath } = useAttribution(scope, props);
  const attribution = { surface, frontend, backend };
  const href = hrefOverride
    ? buildTrackedDocsHref(hrefOverride, attribution)
    : buildIntelligenceAuthEntryHref(attribution);
  const onClick = () =>
    trackEvent(analyticsEvent, {
      location: surface,
      frontend,
      backend,
      from_path: fromPath,
    });
  const link = {
    href,
    target: "_blank",
    rel: "noreferrer",
    onClick,
    // HubSpot rewrites outbound hrefs client-side to add its tracking params.
    suppressHydrationWarning: true,
    "data-cta-surface": surface,
    "data-cta-variant": variant,
  };

  if (variant === "info") {
    return (
      <Callout title={title} className={className}>
        {body ? <p>{body}</p> : null}
        <a
          {...link}
          className="inline-flex items-center gap-1 font-medium text-primary no-underline hover:underline"
        >
          {ctaLabel}
          <ArrowRight className="size-3.5" aria-hidden />
        </a>
      </Callout>
    );
  }

  return (
    <a {...link} className={ctaCardClass(variant, className)}>
      <CtaCardBody
        size={variant}
        title={title}
        body={body}
        label={variant === "tile" ? undefined : ctaLabel}
      />
    </a>
  );
}

export interface SignupLinkProps {
  scope: DocsScope;
  /** Stable analytics id, e.g. "docs_langgraph_quickstart_step1". */
  surface: string;
  frontend?: string;
  backend?: string;
  fromPath?: string;
  children: ReactNode;
}

/** An inline Intelligence sign-up link in prose (shell-docs' `SignupLink`). */
export function SignupLink({
  scope,
  surface,
  children,
  ...props
}: SignupLinkProps) {
  const { frontend, backend, fromPath } = useAttribution(scope, props);
  return (
    <a
      href={buildIntelligenceAuthEntryHref({ surface, frontend, backend })}
      target="_blank"
      rel="noreferrer"
      onClick={() =>
        trackEvent("try_for_free_clicked", {
          location: surface,
          frontend,
          backend,
          from_path: fromPath,
        })
      }
      suppressHydrationWarning
      data-cta-surface={surface}
    >
      {children}
    </a>
  );
}

/** A link whose clicks count as docs conversions (`docs_conversion_clicked`). */
export function DocsTrackedLink({
  href,
  navigateTo,
  surface,
  children,
  className,
  target,
  rel,
}: {
  /** The authored destination, reported to analytics as shell-docs did. */
  href: string;
  /** Where the link actually goes, when the page's scope rewrote it. */
  navigateTo?: string;
  surface: string;
  children: ReactNode;
  className?: string;
  target?: string;
  rel?: string;
}) {
  const to = navigateTo ?? href;
  const props = {
    className,
    target,
    rel,
    onClick: () =>
      trackEvent("docs_conversion_clicked", { surface, destination: href }),
    "data-docs-conversion-surface": surface,
    children,
  };
  return to.startsWith("/") && !to.startsWith("//") ? (
    <Link href={to} {...props} />
  ) : (
    <a href={to} {...props} />
  );
}

/**
 * Marks copies made inside it as conversions: the site's copy tracker
 * (`src/components/telemetry`) reports `docs_conversion_copied` with this
 * surface for any copy whose control sits in a `[data-docs-copy-surface]`.
 */
export function DocsTrackedCopy({
  surface,
  children,
}: {
  surface: string;
  children: ReactNode;
}) {
  return <div data-docs-copy-surface={surface}>{children}</div>;
}
