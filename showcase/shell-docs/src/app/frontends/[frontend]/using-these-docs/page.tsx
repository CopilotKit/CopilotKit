import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  FRONTEND_PAGE_IDS,
  getFrontendGuidanceContentSlug,
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
      canonicalPath: "/",
    });
  }

  const doc = loadDoc(getFrontendGuidanceContentSlug(frontend));
  const option = getFrontendOption(frontend);

  return buildDocMetadata({
    title: `${option.name}: ${doc?.fm.title ?? "using these docs"}`,
    description: doc?.fm.description,
    canonicalPath: `/${frontend}/using-these-docs`,
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

  redirect(`/${frontend}/using-these-docs`);
}
