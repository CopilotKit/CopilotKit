import { redirect } from "next/navigation";

import { legacyDemoRedirect } from "@/lib/frontend-route";

export default async function LegacyPreviewPage({
  params,
}: {
  params: Promise<{ slug: string; demo: string }>;
}) {
  const { slug, demo } = await params;
  redirect(legacyDemoRedirect(slug, demo, "preview"));
}
