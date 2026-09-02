import type { Metadata } from "next";
import { DocsPageView } from "@/components/docs-page-view";
import { buildCookbookNavTree } from "@/lib/cookbook-nav";
import { onboardingFrameworkFor } from "@/lib/docs-onboarding-framework";
import { loadDoc } from "@/lib/docs-render";
import { ROOT_FRAMEWORK } from "@/lib/registry";
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
      // The cookbook lives on the root surface, the Built-in Agent's lens on
      // the docs, and `/<framework>/cookbook/<slug>` already names its
      // framework in the copied prompt. Naming the Built-in Agent here is what
      // keeps the two from disagreeing about the same recipe.
      onboardingFramework={onboardingFrameworkFor(ROOT_FRAMEWORK)}
      navTree={buildCookbookNavTree()}
      sidebarBannerSlot={null}
      sidebarClassName="shell-docs-sidebar-cookbook"
    />
  );
}
