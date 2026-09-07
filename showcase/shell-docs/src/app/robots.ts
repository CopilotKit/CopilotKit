// Next.js App Router robots config. Allows all user-agents across the
// public docs surface, blocks the internal `/api/` routes, and points
// crawlers at sitemap.xml so they can discover every framework variant.

import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/sitemap-helpers";

// Force-dynamic so non-production overrides are read at request time. In
// production getBaseUrl() locks this to the public canonical docs origin.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getBaseUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: "/api/",
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
