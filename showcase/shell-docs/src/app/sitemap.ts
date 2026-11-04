import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/lib/llms/live-inventory";
import { absoluteUrl } from "@/lib/seo/base-url";

// docs.copilotkit.ai's sitemap, ported from shell-docs' `src/app/sitemap.ts`:
// the home page, every live docs page at each URL shell-docs listed it under
// (framework- and frontend-scoped variants included), and the API reference.
// See `sitemapEntries()` for the URL families. URLs are absolute on the
// canonical origin (`getBaseUrl()`).
export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries().map(({ url, lastModified }) => ({
    url: absoluteUrl(url),
    lastModified,
  }));
}
