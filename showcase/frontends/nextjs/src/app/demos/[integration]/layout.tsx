import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getDemo, getIntegration, parseDemoPath } from "@/lib/registry";

type Params = Promise<{ integration: string }>;

// A layout does not receive its child segment, so the demo id comes from the
// `x-pathname` header that src/middleware.ts sets.
export async function generateMetadata({ params }: { params: Params }) {
  const { integration: slug } = await params;
  const integration = getIntegration(slug);
  if (integration === undefined) return {};

  const pathname = (await headers()).get("x-pathname") ?? "";
  const { demo: demoId } = parseDemoPath(pathname);
  const demo = demoId === undefined ? undefined : getDemo(slug, demoId)?.demo;
  const title =
    demo === undefined
      ? integration.name
      : `${integration.name} - ${demo.name}`;
  return { title };
}

export default async function IntegrationLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Params;
}) {
  const { integration } = await params;
  if (getIntegration(integration) === undefined) notFound();
  return children;
}
