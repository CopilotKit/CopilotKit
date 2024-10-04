import { source } from "@/app/source";
import type { Metadata } from "next";
import {
  DocsPage,
  DocsBody,
  DocsDescription,
  DocsTitle,
} from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import defaultMdxComponents from "fumadocs-ui/mdx";

import { Tabs, Tab } from "fumadocs-ui/components/tabs";
import { Steps, Step } from "fumadocs-ui/components/steps";
import { TypeTable } from "fumadocs-ui/components/type-table";
import { Pre, CodeBlock } from "fumadocs-ui/components/codeblock";
import { Callout } from "fumadocs-ui/components/callout";
import { Frame } from "@/components/react/frame";
import { Mermaid } from "@theguild/remark-mermaid/mermaid";
import { Cards, Card } from "fumadocs-ui/components/card";
import { PropertyReference } from "@/components/react/property-reference";
import { getImageMeta } from "fumadocs-ui/og";

const mdxComponents = {
  ...defaultMdxComponents,
  Tabs: Tabs,
  Tab: Tab,
  Steps: Steps,
  Step: Step,
  TypeTable: TypeTable,
  Callout: Callout,
  Frame: Frame,
  Mermaid: Mermaid,
  Cards: Cards,
  Card: Card,
  PropertyReference: PropertyReference,
  // HTML `ref` attribute conflicts with `forwardRef`
  pre: ({ ref: _ref, ...props }: any) => (
    <CodeBlock {...props}>
      <Pre>{props.children}</Pre>
    </CodeBlock>
  ),
};

export default async function Page({
  params,
}: {
  params: { slug?: string[] };
}) {
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      editOnGithub={{
        owner: "CopilotKit",
        repo: "CopilotKit",
        sha: "main",
        path: `/docs/content/docs/${page.file.path}`,
      }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={mdxComponents} renderSmth={() => <div>test</div>} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export function generateMetadata({ params }: { params: { slug?: string[] } }) {
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const image = getImageMeta("og", page.slugs);

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: image,
    },
    twitter: {
      images: image,
      card: "summary_large_image",
    },
  } satisfies Metadata;
}
