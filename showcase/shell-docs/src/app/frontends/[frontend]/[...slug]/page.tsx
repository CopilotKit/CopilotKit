import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { frontendPathForBackend, isFrontendId } from "@/lib/frontend-options";
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
      canonicalPath: "/",
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
        : `/${frontend}/${slugPath}`,
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
  const slugPath = slugPathFromParams(resolvedParams);
  if (frontend === "react") {
    redirect(frontendPathForBackend("react", slugPath));
  }

  if (slugPath === "quickstart") redirect(`/${frontend}`);
  if (slugPath === "using-these-docs") {
    redirect(`/${frontend}/using-these-docs`);
  }

  redirect(`/${frontend}/${slugPath}`);
}
