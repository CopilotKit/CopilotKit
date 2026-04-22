// UnscopedDocsPage — server component that renders a framework-agnostic
// doc page with a RouterPivot banner for picking an agentic backend.
//
// Shared between two routes:
//   app/[[...slug]]/page.tsx    — handles `/` (overview) + unscoped slugs
//   app/[framework]/[[...slug]]/page.tsx — falls through here when the
//     first URL segment is not a registered integration slug. This is
//     necessary because Next.js routes `/<slug>` to [framework] before
//     [[...slug]] (dynamic segment has higher priority than optional
//     catch-all), so without this fallthrough `/<slug>` would always 404.

import React from "react";
import { notFound } from "next/navigation";
import { DocsPageView } from "@/components/docs-page-view";
import {
  FrameworkGuardedContent,
  RouterPivot,
} from "@/components/router-pivot";
import {
  CONTENT_DIR,
  buildNavTree,
  findFrameworksWithCell,
  loadDoc,
  readMeta,
} from "@/lib/docs-render";
import { getIntegration, getIntegrations, getFeature } from "@/lib/registry";
import demoContent from "@/data/demo-content.json";

interface DemoRecord {
  regions?: Record<string, unknown>;
}
const demos: Record<string, DemoRecord> = (
  demoContent as { demos: Record<string, DemoRecord> }
).demos;

export async function UnscopedDocsPage({ slugPath }: { slugPath: string }) {
  const doc = loadDoc(slugPath);
  if (!doc) notFound();

  let navTree;
  let sidebarTitle = "CopilotKit Docs";
  let backLink = null;
  let showPivot = true;
  const integrationMatch = slugPath.match(/^integrations\/([^/]+)/);
  if (integrationMatch) {
    const framework = integrationMatch[1];
    if (!getIntegration(framework)) notFound();
    const frameworkDir = `${CONTENT_DIR}/integrations/${framework}`;
    const frameworkMeta = readMeta(frameworkDir);
    sidebarTitle =
      frameworkMeta?.title ||
      framework.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    navTree = buildNavTree(frameworkDir, `integrations/${framework}`);
    backLink = { label: "← Back to Docs", href: "/" };
    showPivot = false;
  } else {
    navTree = buildNavTree(CONTENT_DIR);
  }

  const options = getIntegrations()
    .slice()
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
    .map((i) => ({
      slug: i.slug,
      name: i.name,
      category: i.category ?? "other",
      logo: i.logo ?? null,
      deployed: i.deployed,
    }));

  const frameworksWithCell = doc.fm.defaultCell
    ? findFrameworksWithCell(
        doc.fm.defaultCell,
        getIntegrations()
          .filter((i) => i.deployed === true)
          .map((i) => i.slug),
        demos,
      )
    : [];

  const featureFromCell = doc.fm.defaultCell
    ? getFeature(doc.fm.defaultCell)
    : undefined;

  let previewUrl: string | null | undefined = undefined;
  if (doc.fm.defaultCell) {
    const sortedIntegrations = getIntegrations()
      .filter((i) => i.deployed === true)
      .sort((a, b) => {
        const orderA = a.sort_order ?? 999;
        const orderB = b.sort_order ?? 999;
        if (orderA !== orderB) return orderA - orderB;
        return a.slug.localeCompare(b.slug);
      });
    for (const integration of sortedIntegrations) {
      const demo = integration.demos?.find((d) => d.id === doc.fm.defaultCell);
      if (demo?.animated_preview_url) {
        previewUrl = demo.animated_preview_url;
        break;
      }
    }
  }

  const pivot =
    showPivot && doc.fm.defaultCell ? (
      <div className="mb-8">
        <RouterPivot
          slugPath={slugPath}
          options={options}
          frameworksWithCell={frameworksWithCell}
          previewUrl={previewUrl}
          featureName={featureFromCell?.name ?? doc.fm.title}
          featureDescription={
            featureFromCell?.description ?? doc.fm.description
          }
        />
      </div>
    ) : null;

  const contentIsFrameworkScoped = showPivot && !!doc.fm.defaultCell;

  return (
    <DocsPageView
      slugPath={slugPath}
      slugHrefPrefix=""
      sidebarTitle={sidebarTitle}
      backLink={backLink}
      navTree={navTree}
      bannerSlot={pivot}
      ContentWrapper={
        contentIsFrameworkScoped ? FrameworkGuardedContent : undefined
      }
    />
  );
}
