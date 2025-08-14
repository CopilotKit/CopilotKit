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
import { InsecurePasswordProtected } from "@/components/react/insecure-password-protected";
import { LinkToCopilotCloud } from "@/components/react/link-to-copilot-cloud";
import { Accordions, Accordion } from "fumadocs-ui/components/accordion";
import { NavigationLink } from "@/components/react/subdocs-menu";
import { getSnippetTOCForPage } from "@/lib/snippet-toc";

/**
 * TODO: This should be dynamic, but it's not working.
 */
const cloudOnlyFeatures = ["Authenticated Actions", "Guardrails"];
const premiumFeatureTitles = [
  "Headless UI",
  "Fully Headless UI",
  "Fully Headless Chat UI",
  "Observability Hooks",
]; // heuristic for pages that import premium snippets

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
  a: ({ href, children, ...props }: any) => (
    <NavigationLink href={href as string} {...props}>{children}</NavigationLink>
  ),
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
  params: Promise<{ slug?: string[] }>;
}) {
  const resolvedParams = await params;
  const page = source.getPage(resolvedParams.slug);
  if (!page) notFound();
  const MDX = page.data.body;
  const cloudOnly = cloudOnlyFeatures.includes(page.data.title);
  
  // Consider a page "Premium" if its slug path contains a "premium" segment OR title matches known premium features OR frontmatter premium flag
  const bySlugPremium = Array.isArray(page.slugs) ? page.slugs.includes("premium") : false;
  const byTitlePremium = premiumFeatureTitles.includes(page.data.title || "");
  const byFrontmatterPremium = Boolean((page as any).data?.premium);
  const isPremium = bySlugPremium || byTitlePremium || byFrontmatterPremium;
  // Compute premium overview href based on current section (first slug segment)
  const baseSegment = Array.isArray(page.slugs) && page.slugs.length ? `/${page.slugs[0]}` : "/";
  const premiumOverviewHref =
    baseSegment === "/" ? "/premium/overview" : `${baseSegment}/premium/overview`;
  
  // Check if the page should hide the header or TOC
  const hideHeader = (page.data as any).hideHeader || false;
  const hideTOC = (page.data as any).hideTOC || false;
  
  // Get TOC from imported snippets and merge with page TOC (only if TOC is not hidden)
  // Use try-catch to handle build-time issues gracefully
  let snippetTOC: any[] = [];
  if (!hideTOC) {
    try {
      snippetTOC = await getSnippetTOCForPage(resolvedParams.slug);
    } catch (error) {
      console.warn('Failed to load snippet TOC:', error);
      snippetTOC = [];
    }
  }
  const combinedTOC = hideTOC ? [] : [...(page.data.toc || []), ...snippetTOC];
  
  return (
    <DocsPage
      toc={combinedTOC}
      full={page.data.full}
      tableOfContent={{
        style:"clerk",
      }}
    >
      <div className={hideHeader ? "" : "min-h-screen"}>
        {!hideHeader && (
          <>
            <div className="flex items-center gap-3">
              <DocsTitle className="flex items-center mb-2">
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
                {isPremium && (
                  <a href={premiumOverviewHref} className="ml-3">
                    <Badge
                      variant="secondary"
                      className="inline-flex items-center gap-2 py-2 px-3.5 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200 hover:bg-indigo-200 border-0 rounded-md transition-colors"
                    >
                      <img
                        src="https://cdn.copilotkit.ai/docs/copilotkit/icons/copilotkit-color.svg"
                        alt="CopilotKit"
                        className="w-4 h-4"
                      />
                      <span className="text-sm font-semibold tracking-tight">Premium</span>
                    </Badge>
                  </a>
                )}
              </DocsTitle>
            </div>
            <DocsDescription>{page.data.description}</DocsDescription>
          </>
        )}
        <DocsBody>
          <MDX components={mdxComponents} />
        </DocsBody>
      </div>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
  const resolvedParams = await params;
  const page = source.getPage(resolvedParams.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  } satisfies Metadata;
}
