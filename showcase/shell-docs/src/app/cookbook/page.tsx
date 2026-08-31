import type { Metadata } from "next";
import { DocsPageView } from "@/components/docs-page-view";
import { buildCookbookNavTree } from "@/lib/cookbook-nav";
import { loadDoc } from "@/lib/docs-render";
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
  return (
    <DocsPageView
      slugPath="cookbook"
      slugHrefPrefix=""
      navTree={buildCookbookNavTree()}
      sidebarBannerSlot={null}
      sidebarClassName="shell-docs-sidebar-cookbook"
    />
  );
}
