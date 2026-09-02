// /cookbook/<...slug> — individual cookbook recipe pages.
//
// Same scoped-sidebar pattern as the landing route (mirrors how
// /reference handles per-item pages). Forces the sidebar tree to the
// cookbook subtree so each recipe shows only its sibling recipes, not
// the full Documentation tree.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsPageView } from "@/components/docs-page-view";
import { buildCookbookNavTree } from "@/lib/cookbook-nav";
import { onboardingFrameworkFor } from "@/lib/docs-onboarding-framework";
import { loadDoc } from "@/lib/docs-render";
import { ROOT_FRAMEWORK } from "@/lib/registry";
import { buildDocMetadata } from "@/lib/seo-metadata";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const slugTail = slug.join("/");
  const slugPath = `cookbook/${slugTail}`;
  const doc = loadDoc(slugPath);
  return buildDocMetadata({
    title: doc?.fm.title ?? slugPath,
    description: doc?.fm.description,
    canonicalPath: `/cookbook/${slugTail}`,
    ogPath: `/og/cookbook/${slugTail}/og.png`,
  });
}

export default async function CookbookSlugPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  if (!slug || slug.length === 0) notFound();
  const slugPath = `cookbook/${slug.join("/")}`;
  return (
    <DocsPageView
      slugPath={slugPath}
      slugHrefPrefix=""
      // Root surface, so the Built-in Agent is the framework this recipe is
      // read with — the same one `/<framework>/cookbook/<slug>` names.
      onboardingFramework={onboardingFrameworkFor(ROOT_FRAMEWORK)}
      navTree={buildCookbookNavTree()}
      sidebarBannerSlot={null}
      sidebarClassName="shell-docs-sidebar-cookbook"
    />
  );
}
