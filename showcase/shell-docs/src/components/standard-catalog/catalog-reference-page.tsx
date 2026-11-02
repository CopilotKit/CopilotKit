import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsPage, DocsBody } from "fumadocs-ui/page";
import { DocsPageView } from "@/components/docs-page-view";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { DocsContentHeader } from "@/components/docs-content-header";
import { navTreeToPageTree } from "@/lib/page-tree-bridge";
import {
  CatalogComponentApi,
  CatalogReferenceDescription,
} from "./catalog-reference-api";
import { CatalogExampleLoader } from "./catalog-example-loader";
import {
  CATALOG_REFERENCE_PATH,
  catalogReferenceNav,
  catalogReferenceNameFromPath,
  catalogComponentHref,
  catalogComponentSlug,
  catalogParts,
} from "./catalog-reference";

function SidebarBanner() {
  return (
    <div className="space-y-3 px-2 py-3">
      <Link href="/generative-ui" className="text-sm text-[var(--text-muted)]">
        ← Back to Generative UI
      </Link>
      <p className="text-sm font-semibold">Standard components</p>
    </div>
  );
}

export async function CatalogReferencePage({ slugPath }: { slugPath: string }) {
  const nav = catalogReferenceNav();
  if (slugPath === CATALOG_REFERENCE_PATH.slice(1))
    return (
      <DocsPageView
        slugPath={slugPath}
        slugHrefPrefix=""
        navTree={nav}
        sidebarBannerSlot={<SidebarBanner />}
      />
    );
  const name = catalogReferenceNameFromPath(slugPath);
  if (!name) notFound();
  const parts = catalogParts(name);
  const toc = [
    { title: "Examples", url: "#examples", depth: 2 },
    { title: "Props", url: "#props", depth: 2 },
    ...parts.map((part) => ({
      title: part,
      url: `#${catalogComponentSlug(part)}`,
      depth: 2,
    })),
  ];
  return (
    <ShellDocsLayout
      tree={navTreeToPageTree(nav, "")}
      banner={<SidebarBanner />}
    >
      <DocsPage
        toc={toc}
        breadcrumb={{ enabled: false }}
        footer={{ enabled: false }}
      >
        <div className="docs-inner-content docs-article-content mx-auto px-4 pb-6 pt-2 md:px-6 md:pt-3 xl:pt-4">
          <DocsContentHeader
            ancestorBreadcrumbs={[
              { label: "Standard catalog", href: CATALOG_REFERENCE_PATH },
            ]}
            title={name}
            description={<CatalogReferenceDescription name={name} />}
          />
          <DocsBody className="reference-content">
            <h2 id="examples" className="scroll-mt-24">
              Examples
            </h2>
            <CatalogExampleLoader name={name} />
            <h2 id="props" className="scroll-mt-24">
              Props
            </h2>
            <CatalogComponentApi name={name} />
            {parts.map((part) => (
              <section key={part} aria-label={part}>
                <h2 id={catalogComponentSlug(part)} className="scroll-mt-24">
                  {part}
                </h2>
                <p>
                  <CatalogReferenceDescription name={part} />
                </p>
                <CatalogExampleLoader name={part} />
                <CatalogComponentApi name={part} />
              </section>
            ))}
            <p>
              <Link href={catalogComponentHref(name)}>Link to {name}</Link> ·{" "}
              <Link href={CATALOG_REFERENCE_PATH}>All standard components</Link>
            </p>
          </DocsBody>
        </div>
      </DocsPage>
    </ShellDocsLayout>
  );
}
