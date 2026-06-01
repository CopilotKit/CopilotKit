// /cookbook — the cookbook landing page.
//
// Mirrors how /reference works today: a dedicated route with a sidebar
// scoped to its own meta.json tree, so opening the cookbook shows only
// the recipes — not the full Documentation tree.

import path from "path";
import type { Metadata } from "next";
import { DocsPageView } from "@/components/docs-page-view";
import { CONTENT_DIR, buildNavTree, loadDoc } from "@/lib/docs-render";
import { buildDocMetadata } from "@/lib/seo-metadata";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const doc = loadDoc("cookbook");
  return buildDocMetadata({
    title: doc?.fm.title ?? "Cookbook",
    description: doc?.fm.description,
    canonicalPath: "/cookbook",
    ogPath: "/og/cookbook/og.png",
  });
}

export default function CookbookLandingPage() {
  // Scope the sidebar to the cookbook subtree only.
  const navTree = buildNavTree(path.join(CONTENT_DIR, "cookbook"), "cookbook");
  return (
    <DocsPageView slugPath="cookbook" slugHrefPrefix="" navTree={navTree} />
  );
}
