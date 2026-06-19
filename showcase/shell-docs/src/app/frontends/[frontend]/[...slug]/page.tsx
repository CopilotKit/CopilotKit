import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DocsPageView } from "@/components/docs-page-view";
import { getFrontendQuickstartNavTree } from "@/lib/frontend-page-content";
import { isFrontendId } from "@/lib/frontend-options";
import { loadDoc } from "@/lib/docs-render";
import { resolveFrontendDocPage } from "@/lib/frontend-doc-policy";
import { buildDocMetadata } from "@/lib/seo-metadata";

type FrontendDocPageParams = {
  frontend: string;
  slug?: string[];
};

function slugPathFromParams(params: FrontendDocPageParams): string {
  return params.slug?.join("/") ?? "";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<FrontendDocPageParams>;
}): Promise<Metadata> {
  const resolvedParams = await params;
  const { frontend } = resolvedParams;
  const slugPath = slugPathFromParams(resolvedParams);

  if (!isFrontendId(frontend) || frontend === "react") {
    return buildDocMetadata({
      title: "Frontend docs",
      canonicalPath: "/frontends",
    });
  }

  const resolution = resolveFrontendDocPage(frontend, slugPath);
  const doc =
    resolution.status === "found" ? loadDoc(resolution.contentSlugPath) : null;

  return buildDocMetadata({
    title: doc?.fm.title ?? slugPath,
    description: doc?.fm.description,
    canonicalPath:
      resolution.status === "found"
        ? resolution.canonicalPath
        : `/frontends/${frontend}/${slugPath}`,
  });
}

export default async function FrontendDocPage({
  params,
}: {
  params: Promise<FrontendDocPageParams>;
}) {
  const resolvedParams = await params;
  const { frontend } = resolvedParams;
  if (!isFrontendId(frontend)) notFound();
  if (frontend === "react") redirect("/");

  const slugPath = slugPathFromParams(resolvedParams);
  if (slugPath === "quickstart") redirect(`/frontends/${frontend}`);
  if (slugPath === "using-these-docs") {
    redirect(`/frontends/${frontend}/using-these-docs`);
  }

  const resolution = resolveFrontendDocPage(frontend, slugPath);
  if (resolution.status === "not-found") notFound();

  return (
    <DocsPageView
      slugPath={resolution.slugPath}
      contentSlugPath={resolution.contentSlugPath}
      slugHrefPrefix={`/frontends/${frontend}`}
      navTree={getFrontendQuickstartNavTree(frontend)}
    />
  );
}
