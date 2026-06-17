import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DocsPage } from "fumadocs-ui/page";
import { FrontendLogo } from "@/components/frontend-logo";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import {
  FRONTEND_PAGE_IDS,
  getFrontendPageContent,
  getFrontendQuickstartNavTree,
} from "@/lib/frontend-page-content";
import type { FrontendPageContent } from "@/lib/frontend-page-content";
import { getFrontendOption, isFrontendId } from "@/lib/frontend-options";
import { navTreeToPageTree } from "@/lib/page-tree-bridge";
import { buildDocMetadata } from "@/lib/seo-metadata";

export function generateStaticParams() {
  return FRONTEND_PAGE_IDS.map((frontend) => ({ frontend }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ frontend: string }>;
}): Promise<Metadata> {
  const { frontend } = await params;
  if (!isFrontendId(frontend) || frontend === "react") {
    return buildDocMetadata({
      title: "Frontend quickstart",
      canonicalPath: "/frontends",
    });
  }
  const content = getFrontendPageContent(frontend);
  return buildDocMetadata({
    title: `${content?.title ?? frontend} quickstart`,
    description: content?.description,
    canonicalPath: `/frontends/${frontend}`,
  });
}

export default async function FrontendQuickstartPage({
  params,
}: {
  params: Promise<{ frontend: string }>;
}) {
  const { frontend } = await params;
  if (!isFrontendId(frontend)) notFound();
  if (frontend === "react") redirect("/");

  const content = getFrontendPageContent(frontend);
  if (!content) notFound();

  const pageTree = navTreeToPageTree(
    getFrontendQuickstartNavTree(content.id),
    "",
  );
  const option = getFrontendOption(frontend);

  return (
    <ShellDocsLayout tree={pageTree} banner={<SidebarFrameworkSelector />}>
      <DocsPage
        toc={[]}
        tableOfContent={{ enabled: false }}
        tableOfContentPopover={{ enabled: false }}
        breadcrumb={{ enabled: false }}
        footer={{ enabled: false }}
      >
        <div className="docs-inner-content mx-auto max-w-[900px] px-4 pb-8 pt-2 md:px-6 md:pt-3 xl:pt-4">
          <header className="border-b border-[var(--border)] pb-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
                <FrontendLogo icon={option.icon} size={24} />
              </div>
              <div>
                <p className="text-[13px] font-medium leading-tight text-[var(--text-muted)]">
                  {content.eyebrow}
                </p>
                <p className="mt-1 text-sm font-semibold leading-tight text-[var(--text)]">
                  {option.name}
                </p>
              </div>
            </div>
            <h1 className="text-[32px] font-medium leading-[1.15] tracking-tight text-[var(--text)] md:text-[40px]">
              {content.title}
            </h1>
            <p className="mt-4 max-w-[62ch] text-lg leading-relaxed text-[var(--text-muted)]">
              {content.description}
            </p>
            <p className="mt-4 inline-flex rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--text-secondary)]">
              {content.status}
            </p>
          </header>

          <section className="border-b border-[var(--border)] py-6">
            <h2 className="text-xl font-semibold tracking-tight text-[var(--text)]">
              Before you start
            </h2>
            <ul className="mt-4 space-y-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              {content.prerequisites.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="border-b border-[var(--border)] py-6">
            <h2 className="text-xl font-semibold tracking-tight text-[var(--text)]">
              Quickstart
            </h2>
            <div className="mt-5 space-y-6">
              {content.steps.map((step, index) => (
                <QuickstartStep key={step.title} step={step} index={index} />
              ))}
            </div>
          </section>

          <section className="py-6">
            <h2 className="text-xl font-semibold tracking-tight text-[var(--text)]">
              Reference
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {content.references.map((reference) => (
                <ReferenceLink key={reference.href} reference={reference} />
              ))}
            </div>
          </section>
        </div>
      </DocsPage>
    </ShellDocsLayout>
  );
}

function QuickstartStep({
  step,
  index,
}: {
  step: FrontendPageContent["steps"][number];
  index: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[2rem_1fr]">
      <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-surface)] text-sm font-semibold text-[var(--text)]">
        {index + 1}
      </div>
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-[var(--text)]">
          {step.title}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
          {step.body}
        </p>
        {step.code ? <CodeBlock code={step.code} /> : null}
      </div>
    </div>
  );
}

function CodeBlock({
  code,
}: {
  code: NonNullable<FrontendPageContent["steps"][number]["code"]>;
}) {
  return (
    <figure className="mt-3 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
      <figcaption className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2 text-[12px] text-[var(--text-muted)]">
        <span>{code.filename ?? code.language}</span>
        <span>{code.language}</span>
      </figcaption>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed text-[var(--text)]">
        <code>{code.value}</code>
      </pre>
    </figure>
  );
}

function ReferenceLink({
  reference,
}: {
  reference: FrontendPageContent["references"][number];
}) {
  const isExternal = reference.href.startsWith("http");
  const className =
    "block rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 transition-colors hover:border-[var(--accent)]";
  const body = (
    <>
      <span className="block text-sm font-semibold text-[var(--text)]">
        {reference.label}
      </span>
      <span className="mt-1 block text-[13px] leading-relaxed text-[var(--text-secondary)]">
        {reference.description}
      </span>
    </>
  );

  if (isExternal) {
    return (
      <a
        href={reference.href}
        target="_blank"
        rel="noreferrer noopener"
        className={className}
      >
        {body}
      </a>
    );
  }

  return (
    <Link href={reference.href} className={className}>
      {body}
    </Link>
  );
}
