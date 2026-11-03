import { source } from "@/lib/source";
import { notFound } from "next/navigation";
import { getPageImageUrl } from "@/lib/shared";
import { docsOgImage } from "@/lib/seo/og-image";

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<"/og/docs/[...slug]">,
) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  return docsOgImage({
    title: page.data.title,
    description: page.data.description,
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageImageUrl(page).segments,
  }));
}
