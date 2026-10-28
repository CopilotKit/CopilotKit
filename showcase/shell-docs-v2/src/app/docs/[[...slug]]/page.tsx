import { Feedback } from "@/components/feedback/client";
import { sendPageFeedback } from "@/lib/feedback";
import { source } from "@/lib/source";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/spacious/page";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/mdx";
import type { Metadata } from "next";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { getPageImageUrl, getPageMarkdownUrl, gitConfig } from "@/lib/shared";

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;

  if (page.data.hero) {
    return (
      <DocsPage toc={page.data.toc} full={page.data.full}>
        <DocsBody>
          <MDX
            components={getMDXComponents({
              a: createRelativeLink(source, page),
            })}
          />
        </DocsBody>
        <Feedback onSendAction={sendPageFeedback} />
      </DocsPage>
    );
  }

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle className="text-[2.25rem] leading-[1.1] font-medium md:text-[2.5rem] tracking-[-0.03em] text-balance">
        {page.data.title}
      </DocsTitle>
      <DocsDescription className="mb-0">
        {page.data.description}
      </DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        {/* Brand: Spline Sans Mono for buttons, like copilotkit.ai's "Copy Prompt". */}
        <MarkdownCopyButton markdownUrl={markdownUrl} className="font-mono" />
        <ViewOptionsPopover
          className="font-mono"
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/${gitConfig.contentDir}/${page.path}`}
        />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: PageProps<"/docs/[[...slug]]">,
): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImageUrl(page).url,
    },
    // Lets agents that land on the HTML find the page's Markdown.
    alternates: {
      types: { "text/markdown": `${page.url}.md` },
    },
  };
}
