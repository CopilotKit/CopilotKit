import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  FRONTEND_PAGE_IDS,
  getFrontendContentSlug,
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
      title: "Frontend quickstart",
      canonicalPath: "/",
    });
  }

  const contentSlug = getFrontendContentSlug(frontend);
  const doc = loadDoc(contentSlug);
  const option = getFrontendOption(frontend);

  return buildDocMetadata({
    title: `${doc?.fm.title ?? option.name} quickstart`,
    description: doc?.fm.description,
    canonicalPath: `/${frontend}`,
  });
}

export default async function FrontendQuickstartPage({
  params,
}: {
  params: Promise<{ frontend: string }>;
}) {
  const { frontend } = await params;
  if (!isFrontendId(frontend)) notFound();
  if (frontend === "react") redirect("/");

  redirect(`/${frontend}`);
}
