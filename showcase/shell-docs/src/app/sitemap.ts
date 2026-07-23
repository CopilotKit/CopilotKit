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
import {
  FRONTEND_PAGE_IDS,
  getFrontendContentSlug,
  getFrontendGuidanceContentSlug,
} from "@/lib/frontend-page-content";
import { loadDoc } from "@/lib/docs-render";
import { getDocsFolder, getIntegrations, ROOT_FRAMEWORK } from "@/lib/registry";

// Force-dynamic so the sitemap is regenerated per request and reads
// the LIVE NEXT_PUBLIC_BASE_URL via getRuntimeConfig(). Without this
// Next.js would statically prerender the sitemap at build time and
// freeze whichever value `process.env.NEXT_PUBLIC_BASE_URL` had at
// `next build` — defeating the runtime-config switch.
export const dynamic = "force-dynamic";

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
  //
  // ROOT_FRAMEWORK (Built-in Agent) is excluded from the framework-
  // scoped expansion: its docs are served at the root surface, and every
  // `/built-in-agent/*` URL permanently redirects to `/*`. Its override
  // pages are emitted at their bare root URLs instead.
  const bareDocs = getBareDocsPages();
  const integrations = getIntegrations().filter(
    (i) => i.slug !== ROOT_FRAMEWORK,
  );

  // Track every framework-scoped URL we've already emitted so the
  // override loop below can skip duplicates without scanning the array.
  const seenFrameworkUrls = new Set<string>();
  const bareSlugs = new Set(bareDocs.map((d) => d.slug));

  for (const { slug, filePath } of bareDocs) {
    const lastModified = resolveLastModified(filePath);
    // The root `built-in-agent.mdx` topic page collides with the
    // retired framework prefix: its bare URL permanently redirects to
    // `/`, so only the framework-scoped variants are listed.
    if (slug !== ROOT_FRAMEWORK) {
      entries.push({
        url: `${baseUrl}/${slug}`,
        lastModified,
      });
    }
    for (const integration of integrations) {
      const url = `${baseUrl}/${integration.slug}/${slug}`;
      seenFrameworkUrls.add(url);
      entries.push({ url, lastModified });
    }
  }

  // Framework landing pages: /<framework> on its own. ROOT_FRAMEWORK's
  // landing is the root entry already pushed above.
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

  // ROOT_FRAMEWORK override pages serve at bare root URLs. Slugs that
  // shadow a bare doc (e.g. quickstart) are already covered above; the
  // folder's index is the root entry.
  for (const { slug, filePath } of getFrameworkOverridePages(
    getDocsFolder(ROOT_FRAMEWORK),
  )) {
    if (!slug || bareSlugs.has(slug)) continue;
    entries.push({
      url: `${baseUrl}/${slug}`,
      lastModified: resolveLastModified(filePath),
    });
  }

  // Frontend quickstarts. The source MDX lives under
  // content/docs/frontends/*, but those files are not served as
  // /frontends/* docs anymore; they canonicalize to /<frontend>.
  for (const frontend of FRONTEND_PAGE_IDS) {
    const doc = loadDoc(getFrontendContentSlug(frontend));
    if (doc) {
      entries.push({
        url: `${baseUrl}/${frontend}`,
        lastModified: resolveLastModified(doc.filePath),
      });
    }
  }

  const angularFeaturesDoc = loadDoc("frontends/angular/features");
  if (angularFeaturesDoc) {
    entries.push({
      url: `${baseUrl}/angular/features`,
      lastModified: resolveLastModified(angularFeaturesDoc.filePath),
    });
  }

  // Status/guidance page, emitted once per non-React frontend.
  for (const frontend of FRONTEND_PAGE_IDS) {
    const doc = loadDoc(getFrontendGuidanceContentSlug(frontend));
    if (doc) {
      entries.push({
        url: `${baseUrl}/${frontend}/using-these-docs`,
        lastModified: resolveLastModified(doc.filePath),
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
