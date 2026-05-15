// UnscopedDocsPage — server component for `/<feature>` URLs where the
// first segment isn't a registered integration slug (e.g. `/threads`,
// `/frontend-tools`). RouterPivot redirects the visitor to
// `/<effectiveFramework>/<feature>` on mount; with the soft-default,
// that's always Built-in Agent for fresh visitors.
//
// Shared between `app/[[...slug]]/page.tsx` and the
// `app/[framework]/[[...slug]]/page.tsx` fall-through (when the first
// URL segment isn't a registered integration).

import React from "react";
import { notFound } from "next/navigation";
import { DocsPageView } from "@/components/docs-page-view";
import {
  FrameworkGuardedContent,
  RouterPivot,
} from "@/components/router-pivot";
import { loadDoc } from "@/lib/docs-render";

export async function UnscopedDocsPage({ slugPath }: { slugPath: string }) {
  // The legacy `/integrations/<framework>/<slug>` URL scheme is dead.
  // The canonical short form `/<framework>/<slug>` is served by the
  // framework-scoped route. Refuse to render a doc page from
  // `loadDoc("integrations/...")` here so the legacy URL surfaces as a
  // 404 rather than rendering with a stray, unscoped sidebar.
  if (slugPath.startsWith("integrations/")) notFound();

  const doc = loadDoc(slugPath);
  if (!doc) notFound();

  // Pivot redirects to /<effectiveFramework>/<slugPath>. Only feature
  // pages (those declaring a defaultCell in frontmatter) use the pivot —
  // generic doc pages render their body directly.
  const pivot = doc.fm.defaultCell ? (
    <div className="mb-8">
      <RouterPivot slugPath={slugPath} />
    </div>
  ) : null;

  return (
    <DocsPageView
      slugPath={slugPath}
      slugHrefPrefix=""
      bannerSlot={pivot}
      ContentWrapper={doc.fm.defaultCell ? FrameworkGuardedContent : undefined}
    />
  );
}
