import type { Metadata } from "next";
import { absoluteUrl } from "./base-url";

// Per-page SEO and social metadata for live pages, ported from shell-docs'
// `buildDocMetadata()` (src/lib/seo-metadata.ts): a self-canonical URL and
// Open Graph / Twitter cards pointing at the page's `/og/<path>/og.png`. All
// URLs are absolute on the canonical origin, since social platforms don't
// know the site's base URL.

const SITE_NAME = "CopilotKit Docs";
const DEFAULT_DESCRIPTION =
  "Docs, live demos, and integrations for CopilotKit.";

/** shell-docs' home page title and description. */
export const HOME_TITLE = "CopilotKit: bring your agent into any app";
export const HOME_DESCRIPTION =
  "CopilotKit is an open-source framework that connects your app to AI agents. Add chat, interactive UI, and human approvals, with your choice of any agent backend.";

/** The social card route for a live URL: `/mastra/x` is `/og/mastra/x/og.png`. */
export function ogImagePath(path: string): string {
  return `/og${path === "/" ? "" : path}/og.png`;
}

/**
 * `canonical`, `openGraph`, and `twitter` for a live page at `path`
 * (`/mastra/frontend-tools`, or `/` for the home page).
 */
export function liveDocMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description?: string;
  path: string;
}): Pick<Metadata, "alternates" | "openGraph" | "twitter"> {
  const text = description?.trim() || DEFAULT_DESCRIPTION;
  const url = absoluteUrl(path);
  const image = absoluteUrl(ogImagePath(path));
  return {
    alternates: { canonical: url },
    openGraph: {
      title,
      description: text,
      url,
      siteName: SITE_NAME,
      type: "article",
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: text,
      images: [image],
    },
  };
}
