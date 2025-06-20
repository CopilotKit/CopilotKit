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
import { Badge } from "@/components/ui/badge";
import { CloudIcon } from "lucide-react";

import { Tabs, Tab } from "@/components/react/tabs";
import { Steps, Step } from "fumadocs-ui/components/steps";
import { TypeTable } from "fumadocs-ui/components/type-table";
import { Pre, CodeBlock } from "fumadocs-ui/components/codeblock";
import { Callout } from "fumadocs-ui/components/callout";
import { Frame } from "@/components/react/frame";
import { Mermaid } from "@theguild/remark-mermaid/mermaid";
import { Cards, Card } from "fumadocs-ui/components/card";
import { PropertyReference } from "@/components/react/property-reference";
import { getImageMeta } from "fumadocs-ui/og";
import { InsecurePasswordProtected } from "@/components/react/insecure-password-protected";
import { LinkToCopilotCloud } from "@/components/react/link-to-copilot-cloud";
import { Accordions, Accordion } from "fumadocs-ui/components/accordion";

/**
 * TODO: This should be dynamic, but it's not working.
 */
const cloudOnlyFeatures = ["Authenticated Actions", "Guardrails"];

const mdxComponents = {
  ...defaultMdxComponents,
  InsecurePasswordProtected: InsecurePasswordProtected,
  LinkToCopilotCloud: LinkToCopilotCloud,
  Accordions: Accordions,
  Accordion: Accordion,
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
  const cloudOnly = cloudOnlyFeatures.includes(page.data.title);
  return (
    <DocsPage
      toc={[]}
      full={page.data.full}

    >
      <div className="flex items-center gap-3">
        <DocsTitle className="flex items-center">
          {page.data.title}
          {cloudOnly && (
            <Badge
              variant="secondary"
              className="ml-3 mt-1 inline-flex items-center gap-1.5 py-1.5 px-3 bg-indigo-600/90 text-white hover:bg-indigo-600 border-0 rounded-md transition-colors"
            >
              <CloudIcon className="w-3 h-3" />
              <span className="text-xs">Cloud Only</span>
            </Badge>
          )}
        </DocsTitle>
      </div>
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
