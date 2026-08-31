// Shared helper for building per-page SEO/social Metadata across the
// four catch-all docs routes:
//   - src/app/[[...slug]]/page.tsx
//   - src/app/[framework]/[[...slug]]/page.tsx
//   - src/app/ag-ui/[[...slug]]/page.tsx
//   - src/app/reference/[...slug]/page.tsx
//
// Each route previously returned only `alternates.canonical`, leaving every
// page to inherit the layout's generic title/description (identical across
// the whole site) and emitting zero `og:*` / `twitter:*` tags. That broke
// Slack/X/LinkedIn unfurls on every shared docs URL and harmed search
// indexing because all 2400+ pages shared one description.
//
// This helper centralises title / description / canonical / openGraph /
// twitter card so callers only have to thread frontmatter through.
//
// All URLs are absolute (built from `getBaseUrl()`) so social platforms,
// which never know the site's base URL, resolve them correctly without
// requiring `metadataBase` on the root layout.

import type { Metadata } from "next";
import { getBaseUrl } from "@/lib/sitemap-helpers";

const SITE_NAME = "CopilotKit Docs";
const DEFAULT_DESCRIPTION =
  "Docs, live demos, and integrations for CopilotKit.";

/**
 * Inputs for building a doc page's Metadata object. Title and description
 * come from MDX frontmatter (with sensible fallbacks for when a page omits
 * them). `canonicalPath` is the absolute URL path of the page, starting
 * with `/`. `ogPath` is the route that returns the page's OG PNG; when
 * omitted, the social card falls back to a static CDN image so unfurls
 * still render even before per-page OG images come online.
 */
export interface DocMetadataInput {
  /** Page title; rendered as `<title>` and used in OG/Twitter card. */
  title: string;
  /** One-line description; used in `<meta description>`, OG, Twitter. */
  description?: string;
  /** Absolute URL path of the canonical page (e.g. `/quickstart`). */
  canonicalPath: string;
  /**
   * Absolute URL path of the OG image route for this page. Optional;
   * callers without a per-page OG route should omit this and the helper
   * substitutes the brand fallback so social unfurls still render.
   */
  ogPath?: string;
}

/**
 * Build a Metadata object suitable for return from a route's
 * `generateMetadata`. Centralises the title/description/canonical/og/
 * twitter wiring so the four catch-all routes stay consistent and any
 * change to social-card behaviour is a one-line edit.
 */
export function buildDocMetadata(input: DocMetadataInput): Metadata {
  const base = getBaseUrl();
  const description = input.description?.trim() || DEFAULT_DESCRIPTION;
  const title = input.title?.trim() || SITE_NAME;
  const canonical = `${base}${input.canonicalPath}`;
  // Fallback brand card kept on CDN so social embeds always render even
  // for pages without a per-page OG route or when the OG renderer fails.
  // Keep this in sync with the OG route's own fallback path.
  const ogImageUrl = input.ogPath
    ? `${base}${input.ogPath}`
    : "https://cdn.copilotkit.ai/docs/copilotkit/images/og-fallback.png";

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: SITE_NAME,
      type: "article",
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}
