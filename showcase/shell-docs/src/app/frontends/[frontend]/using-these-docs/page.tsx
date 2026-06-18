import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DocsPageView } from "@/components/docs-page-view";
import {
  FRONTEND_GUIDANCE_CONTENT_SLUG,
  FRONTEND_PAGE_IDS,
  getFrontendQuickstartNavTree,
} from "@/lib/frontend-page-content";
import { getFrontendOption, isFrontendId } from "@/lib/frontend-options";
import { loadDoc } from "@/lib/docs-render";
import { buildDocMetadata } from "@/lib/seo-metadata";

export function generateStaticParams() {
  return FRONTEND_PAGE_IDS.map((frontend) => ({ frontend }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ frontend: string }>;
}): Promise<Metadata> {
  const { frontend } = await params;
  if (!isFrontendId(frontend) || frontend === "react") {
    return buildDocMetadata({
      title: "Using these frontend docs",
      canonicalPath: "/frontends",
    });
  }

  const doc = loadDoc(FRONTEND_GUIDANCE_CONTENT_SLUG);
  const option = getFrontendOption(frontend);

  return buildDocMetadata({
    title: `${option.name}: ${doc?.fm.title ?? "using these docs"}`,
    description: doc?.fm.description,
    canonicalPath: `/frontends/${frontend}/using-these-docs`,
  });
}

export default async function FrontendGuidancePage({
  params,
}: {
  params: Promise<{ frontend: string }>;
}) {
  const { frontend } = await params;
  if (!isFrontendId(frontend)) notFound();
  if (frontend === "react") redirect("/");

  if (!loadDoc(FRONTEND_GUIDANCE_CONTENT_SLUG)) notFound();

  return (
    <DocsPageView
      slugPath="using-these-docs"
      contentSlugPath={FRONTEND_GUIDANCE_CONTENT_SLUG}
      slugHrefPrefix={`/frontends/${frontend}`}
      navTree={getFrontendQuickstartNavTree(frontend)}
    />
  );
}
