// UnscopedDocsPage — server component for `/<slug>` URLs where the
// first segment isn't a registered integration slug (e.g. `/quickstart`,
// `/concepts/architecture`).
//
// The Built-in Agent docs are served at the ROOT surface: when BIA (the
// default framework, `docs_mode: authored`) has a page for the slug
// under `integrations/built-in-agent/`, that page renders here BIA-scoped
// — exactly what `/built-in-agent/<slug>` used to serve before the prefix
// was retired. Agnostic slugs (no BIA override) render the root MDX.
//
// Either way the sidebar is the SAME unified tree (`buildRootSurfaceNav`):
// the BIA IA with the agnostic root sections folded in. This is what
// keeps the sidebar stable as you move between a BIA page and an agnostic
// page at the root — without it, the two IAs swap and the whole sidebar
// reshuffles.
//
// Shared between `app/[[...slug]]/page.tsx` and the
// `app/[framework]/[[...slug]]/page.tsx` fall-through (when the first
// URL segment isn't a registered integration).

import React from "react";
import { notFound } from "next/navigation";
import { DocsPageView } from "@/components/docs-page-view";
import { onboardingFrameworkFor } from "@/lib/docs-onboarding-framework";
import { buildRootSurfaceNav, loadDoc } from "@/lib/docs-render";
import { getDocsFolder, getDocsMode, ROOT_FRAMEWORK } from "@/lib/registry";

export async function UnscopedDocsPage({ slugPath }: { slugPath: string }) {
  // The legacy `/integrations/<framework>/<slug>` URL scheme is dead.
  // Refuse to render a doc page from `loadDoc("integrations/...")` here
  // so the legacy URL surfaces as a 404 (middleware redirects cover the
  // real traffic) rather than rendering with a stray, unscoped sidebar.
  if (slugPath.startsWith("integrations/")) notFound();

  // One sidebar for the entire root surface (BIA IA + folded-in agnostic
  // sections), so navigating between BIA and agnostic pages never swaps it.
  const docsFolder = getDocsFolder(ROOT_FRAMEWORK);
  const navTree = buildRootSurfaceNav(docsFolder);

  // The page-tools "Copy agent prompt" button follows `frameworkOverride` and
  // nothing else: a root-surface page that renders framework-scoped (either
  // branch below) is reading about the Built-in Agent and can name it in the
  // copied prompt, while a genuinely frameworkless page (`/faq`, `/examples`)
  // has no framework to name and keeps getting no button. Both props are
  // derived from the same local in each branch, so the button and the content
  // resolution cannot drift apart.

  // BIA-authored page for this slug → render it BIA-scoped at the root
  // URL: BIA snippet resolution, root-relative hrefs.
  const overridePath = `integrations/${docsFolder}/${slugPath}`;
  if (getDocsMode(ROOT_FRAMEWORK) === "authored" && loadDoc(overridePath)) {
    const frameworkOverride = ROOT_FRAMEWORK;
    return (
      <DocsPageView
        slugPath={slugPath}
        contentSlugPath={overridePath}
        slugHrefPrefix=""
        frameworkOverride={frameworkOverride}
        onboardingFramework={onboardingFrameworkFor(frameworkOverride)}
        navTree={navTree}
      />
    );
  }

  const doc = loadDoc(slugPath);
  if (!doc) notFound();

  // Agnostic page. Feature pages (those declaring a snippet cell) used to
  // bounce every visitor to `/built-in-agent/<slug>` via a client-side
  // redirect and hide the body in the meantime. Render them in place
  // instead, resolved against the default framework — the same content
  // the bounce produced, minus the redirect. Pages without a cell render
  // framework-agnostic. Both keep the unified root-surface sidebar.
  const frameworkOverride = doc.fm.defaultCell ? ROOT_FRAMEWORK : undefined;
  return (
    <DocsPageView
      slugPath={slugPath}
      slugHrefPrefix=""
      frameworkOverride={frameworkOverride}
      onboardingFramework={onboardingFrameworkFor(frameworkOverride)}
      navTree={navTree}
    />
  );
}
