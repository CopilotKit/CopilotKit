import { docsLlms, source } from "@/lib/source";
import { getPageMarkdownUrl } from "@/lib/shared";
import { notFound } from "next/navigation";

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<"/llms.mdx/docs/[[...slug]]">,
) {
  const { slug } = await params;
  // remove the appended "content.md", `/docs/index.md` is rewritten to the root page
  const slugs = slug?.slice(0, -1) ?? [];
  if (slugs.at(-1) === "index") slugs.pop();
  const page = source.getPage(slugs);
  if (!page) notFound();

  return new Response(await docsLlms.page(page), {
    headers: {
      "Content-Type": "text/markdown",
    },
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageMarkdownUrl(page).segments,
  }));
}
