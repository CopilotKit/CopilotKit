// Next.js App Router sitemap. Emits one entry per (root URL, framework
// variant) pair so search engines can crawl every framework-scoped doc
// at its self-canonical URL.
//
// The expansion is:
//   - Root URL (/)
//   - Bare unscoped pages (/<slug>)            from src/content/docs/**.mdx
//   - Framework-scoped pages (/<fw>/<slug>)    bare slugs × every registered
//                                              integration, plus per-framework
//                                              override pages under
//                                              src/content/docs/integrations/
//   - Reference (/reference/<slug>)            from src/content/reference/
//   - AG-UI (/ag-ui/<slug>)                    from src/content/ag-ui/
//
// Each entry's `lastModified` is resolved via resolveLastModified —
// frontmatter `lastmod` first, then file mtime, then `new Date()`.

import type { MetadataRoute } from "next";
import {
  getAgUiPages,
  getBareDocsPages,
  getBaseUrl,
  getFrameworkOverridePages,
  getReferencePages,
  resolveLastModified,
} from "@/lib/sitemap-helpers";
import { getDocsFolder, getIntegrations } from "@/lib/registry";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getBaseUrl();
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  // 1. Root / overview.
  entries.push({
    url: `${baseUrl}/`,
    lastModified: now,
  });

  // 2. Bare unscoped docs and 3. framework-scoped variants. Each bare
  // slug generates one bare entry plus N framework-scoped entries — one
  // per registered integration. Per-framework override pages are added
  // alongside (deduped against the bare × framework cross-product).
  const bareDocs = getBareDocsPages();
  const integrations = getIntegrations();

  // Track every framework-scoped URL we've already emitted so the
  // override loop below can skip duplicates without scanning the array.
  const seenFrameworkUrls = new Set<string>();

  for (const { slug, filePath } of bareDocs) {
    const lastModified = resolveLastModified(filePath);
    entries.push({
      url: `${baseUrl}/${slug}`,
      lastModified,
    });
    for (const integration of integrations) {
      const url = `${baseUrl}/${integration.slug}/${slug}`;
      seenFrameworkUrls.add(url);
      entries.push({ url, lastModified });
    }
  }

  // Framework landing pages: /<framework> on its own.
  for (const integration of integrations) {
    const url = `${baseUrl}/${integration.slug}`;
    seenFrameworkUrls.add(url);
    entries.push({ url, lastModified: now });
  }

  // Per-framework override pages — topics that only exist under
  // integrations/<folder>/. These are addressable as /<framework>/<slug>
  // and aren't covered by the bare × framework cross-product above.
  for (const integration of integrations) {
    const folder = getDocsFolder(integration.slug);
    for (const { slug, filePath } of getFrameworkOverridePages(folder)) {
      const url = `${baseUrl}/${integration.slug}/${slug}`;
      if (seenFrameworkUrls.has(url)) continue;
      seenFrameworkUrls.add(url);
      entries.push({
        url,
        lastModified: resolveLastModified(filePath),
      });
    }
  }

  // 4. Reference docs.
  for (const { slug, filePath } of getReferencePages()) {
    entries.push({
      url: `${baseUrl}/reference/${slug}`,
      lastModified: resolveLastModified(filePath),
    });
  }
  // Reference index.
  entries.push({ url: `${baseUrl}/reference`, lastModified: now });

  // 5. AG-UI.
  for (const { slug, filePath } of getAgUiPages()) {
    entries.push({
      url: `${baseUrl}/ag-ui/${slug}`,
      lastModified: resolveLastModified(filePath),
    });
  }
  // AG-UI overview landing.
  entries.push({ url: `${baseUrl}/ag-ui`, lastModified: now });

  return entries;
}
