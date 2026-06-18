import type { Metadata } from "next";
import { redirect } from "next/navigation";
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
  redirect("/cookbook/daytona");
}
