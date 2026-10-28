// <FrameworkOverview frameworkName="Mastra" ... />: a partner framework's
// landing page, authored in `integrations/<folder>/index.mdx`. A port of
// shell-docs' content/landing-pages/{mdx-framework-overview,
// framework-overview, partner-feature-explorer}.tsx and
// lib/partner-showcase-demos.ts.
//
// The landing serves every URL variant of its folder (`/langgraph-fastapi`
// renders `integrations/langgraph/index.mdx`), so authored links naming the
// folder's slug are rewritten to the URL's framework and frontend.

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { DocsCode } from "../code";
import type { DocsMdxContext } from "../context";
import { getFrontendCatalog, getIntegration } from "../data";
import { docsHref } from "../href";
import type { DocsScope } from "../scope";
import { FeatureExplorer, TrackedLink, type ExplorerFeature } from "./client";
import { scopeRoot } from "./paths";
import { ACTION_LINK, PRIMARY_PILL } from "./styles";

interface SupportedFeature {
  title: string;
  description: string;
  iconKey?: string;
  documentationLink: string;
  demoLink?: string;
  videoUrl?: string;
}

interface OpsPlatformCTAData {
  variant: "card" | "banner";
  title: string;
  body: string;
  ctaLabel: string;
  surface: string;
}

export interface FrameworkOverviewProps {
  frameworkName: string;
  frameworkIcon?: ReactNode;
  header?: string;
  subheader?: string;
  guideLink?: string;
  initCommand?: string;
  featuresLink?: string;
  supportedFeatures?: SupportedFeature[];
  /** Capability-card intro. */
  lede?: string;
  capabilitiesFootnote?: { text: string; linkLabel: string; href: string };
  connect?: {
    intro: string;
    filename: string;
    code?: string;
    language?: string;
    guideLink: string;
  };
  showcase?: { integration: string; intro: string };
  /** Rendered after the capabilities; wins over `cta`. */
  afterFeatures?: ReactNode;
  cta?: OpsPlatformCTAData;
  /** Used when the URL names no framework. */
  currentFramework?: string;
  /** The "Connect your agent" snippet, authored as a code fence. */
  children?: ReactNode;
  // Accepted from older authored files and not shown (as in shell-docs).
  bannerVideo?: string;
  architectureImage?: string;
  architectureVideo?: string;
  liveDemos?: unknown[];
  tutorialLink?: string;
}

/** The showcase features a landing offers live, in order, with their copy. */
const FEATURE_COPY: Record<string, { title: string; description: string }> = {
  "agentic-chat": {
    title: "Chat",
    description: "Talk to your agent in a ready-made chat interface.",
  },
  "gen-ui-tool-based": {
    title: "Generative UI",
    description: "Turn your agent’s responses into interactive components.",
  },
  "hitl-in-chat": {
    title: "Human-in-the-loop",
    description: "Review a decision before your agent takes the next step.",
  },
  "shared-state-read-write": {
    title: "Shared state",
    description: "Keep your app and agent in sync as they work.",
  },
  "frontend-tools": {
    title: "Frontend tools",
    description: "Let your agent take actions in your app.",
  },
  "headless-complete": {
    title: "Headless UI",
    description: "Build your own interface with full control.",
  },
  subagents: {
    title: "Sub-agents",
    description: "Show work delegated to specialized agents.",
  },
  "declarative-gen-ui": {
    title: "Declarative UI",
    description: "Render structured interfaces from your agent.",
  },
};

/** The explorer's order: chat, the two Intelligence walkthroughs, the rest. */
const EXPLORER_ORDER = [
  "gen-ui-tool-based",
  "declarative-gen-ui",
  "hitl-in-chat",
  "frontend-tools",
  "shared-state-read-write",
  "headless-complete",
  "subagents",
];

const WALKTHROUGHS: ExplorerFeature[] = [
  {
    id: "threads",
    title: "AG-UI Streams",
    description: "Keep conversations, UI, and tool activity across sessions.",
    src: "https://www.loom.com/embed/79817778d29e490c97225127d2f17b3a",
  },
  {
    id: "learning",
    title: "Automatic Learning",
    description: "Turn past interactions into improvements you can review.",
    src: "https://www.loom.com/embed/2978fbfe42324e509057ac5fd46b7a70",
  },
];

/**
 * The framework's runnable showcase demos on this frontend: only exact
 * catalog cells, never another backend's demo or a missing one.
 */
function explorerFeatures(
  integration: string,
  frontend: string,
): ExplorerFeature[] {
  const int = getIntegration(integration);
  const demos = getFrontendCatalog()
    .filter(
      (c) =>
        c.frontend === frontend &&
        c.integration === integration &&
        c.runnable &&
        c.feature in FEATURE_COPY,
    )
    .flatMap((c): ExplorerFeature[] => {
      const route = int?.demos.find((d) => d.id === c.feature)?.route;
      if (!int?.backend_url || !route) return [];
      return [
        {
          id: c.feature,
          ...FEATURE_COPY[c.feature],
          src: new URL(
            frontend === "angular" ? `/angular/${c.feature}` : route,
            int.backend_url,
          ).href,
          href: `https://showcase.copilotkit.ai/${frontend}/${integration}/${c.feature}`,
          sourceHref:
            frontend !== "angular" && int.repo && route.startsWith("/demos/")
              ? `${int.repo}/src/app${route}`
              : undefined,
        },
      ];
    });
  return [
    ...demos.filter((d) => d.id === "agentic-chat"),
    ...WALKTHROUGHS,
    ...demos
      .filter((d) => EXPLORER_ORDER.includes(d.id))
      .sort((a, b) => EXPLORER_ORDER.indexOf(a.id) - EXPLORER_ORDER.indexOf(b.id)),
  ];
}

/** `/langgraph/quickstart` on `/langgraph-fastapi` is `/langgraph-fastapi/quickstart`. */
function stripSlug(href: string, slugs: string[]): string {
  for (const slug of slugs) {
    if (!slug) continue;
    if (href === `/${slug}`) return "/";
    if (href.startsWith(`/${slug}/`)) return href.slice(slug.length + 1);
  }
  return href;
}

const SECTION_TITLE = "text-2xl leading-[1.33] font-semibold";

export function FrameworkOverview({
  scope,
  ctx,
  frameworkName,
  frameworkIcon,
  guideLink = "",
  initCommand = "npx copilotkit@latest init",
  supportedFeatures = [],
  lede,
  capabilitiesFootnote,
  connect,
  showcase,
  afterFeatures,
  cta,
  currentFramework,
  children,
}: FrameworkOverviewProps & { scope: DocsScope; ctx: DocsMdxContext }) {
  const fromSlug = guideLink.split("/")[1] ?? "";
  const framework = scope.framework ?? currentFramework ?? fromSlug;
  const local: DocsScope = { ...scope, framework: framework || null };
  const fromPath = scopeRoot(local);
  const link = (href: string) => {
    const path = stripSlug(href, [fromSlug, framework]);
    return path === "/" ? fromPath : docsHref(path, local);
  };
  const analytics = {
    frontend: scope.frontend,
    backend: framework,
    from_path: fromPath,
  };
  const angular = scope.frontend === "angular";
  // The authored copy names React; on Angular the same capability is Angular's.
  const forFrontend = (text: string) =>
    angular
      ? text.replace(/\bReact components?\b/g, (m) =>
          m.endsWith("s") ? "Angular components" : "an Angular component",
        )
      : text;

  const quickstartHref = link(guideLink || "/quickstart");
  const features = explorerFeatures(framework, scope.frontend);

  const OpsPlatformCTA = (ctx.components() as Record<string, unknown>)
    .OpsPlatformCTA as ComponentType<Record<string, unknown>> | undefined;
  const extra =
    afterFeatures ??
    (cta && OpsPlatformCTA ? (
      <OpsPlatformCTA
        variant={cta.variant === "banner" ? "inline" : "card"}
        title={cta.title}
        body={cta.body}
        ctaLabel={cta.ctaLabel}
        surface={cta.surface}
        frontend={scope.frontend}
        backend={framework}
        fromPath={fromPath}
      />
    ) : null);

  return (
    <div className="not-prose flex flex-col gap-14">
      <header className="flex flex-col items-start gap-6">
        <p className="flex items-center gap-3 text-sm font-medium text-muted-foreground">
          {scope.framework ? (
            <FrameworkLogo slug={framework} size={40} />
          ) : (
            <span className="flex size-10 items-center justify-center text-foreground [&_svg]:size-10">
              {frameworkIcon}
            </span>
          )}
          CopilotKit + {frameworkName}
        </p>
        <h1 className="text-[2.25rem] leading-[1.1] font-medium tracking-[-0.03em] text-balance md:text-[2.5rem]">
          Bring your {frameworkName} agents
          <span className="block">into any app</span>
        </h1>
        <p className="max-w-[38rem] text-lg leading-relaxed text-muted-foreground">
          CopilotKit is an open-source framework that connects your app to{" "}
          {frameworkName} agents. Give your agents chat, generative UI,
          human-in-the-loop, AG-UI Streams, Automatic Learning and more.
        </p>
        <TrackedLink
          href={quickstartHref}
          event="docs.journey_continued"
          properties={{
            ...analytics,
            destination_type: "quickstart",
            destination_path: quickstartHref,
          }}
          className={PRIMARY_PILL}
        >
          Quickstart
          <ArrowRight className="size-4" aria-hidden="true" />
        </TrackedLink>
      </header>

      <div className="flex flex-col gap-4">
        <FeatureExplorer
          features={features}
          frameworkName={frameworkName}
          analytics={analytics}
        />
        {showcase?.intro ? (
          <p className="text-muted-foreground">{showcase.intro}</p>
        ) : null}
      </div>

      {supportedFeatures.length > 0 ? (
        <section
          aria-labelledby="framework-capabilities"
          className="flex flex-col gap-4"
        >
          <h2 id="framework-capabilities" className={SECTION_TITLE}>
            Build with {frameworkName}
          </h2>
          <p className="leading-relaxed text-muted-foreground">
            {lede ??
              `Add the user-facing capabilities your ${frameworkName} agents need.`}
          </p>
          <div className="grid auto-rows-fr grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-2 rounded-[20px] bg-frame p-2">
            {supportedFeatures.map((feature) => (
              <article
                key={feature.title}
                className="flex flex-col gap-2 rounded-lg bg-tray-card p-5"
              >
                <h3 className="text-base leading-6 font-semibold">
                  {feature.title}
                </h3>
                <p className="text-sm leading-normal text-muted-foreground">
                  {forFrontend(feature.description)}
                </p>
                <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-2 text-sm">
                  <Link
                    href={link(feature.documentationLink)}
                    className={ACTION_LINK}
                  >
                    Read the docs
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                  {feature.demoLink ? (
                    <TrackedLink
                      href={link(feature.demoLink)}
                      event="docs.journey_continued"
                      properties={{
                        ...analytics,
                        destination_type: "demo",
                        destination_path: link(feature.demoLink),
                      }}
                      className={ACTION_LINK}
                    >
                      Live demo
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    </TrackedLink>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          {capabilitiesFootnote ? (
            <p className="text-sm text-muted-foreground">
              {capabilitiesFootnote.text}{" "}
              <Link
                href={link(capabilitiesFootnote.href)}
                className={ACTION_LINK}
              >
                {capabilitiesFootnote.linkLabel}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}

      <section
        id="setup"
        aria-labelledby="framework-setup"
        className="flex scroll-mt-24 flex-col gap-4"
      >
        <h2 id="framework-setup" className={SECTION_TITLE}>
          Start building
        </h2>
        <p className="leading-relaxed text-muted-foreground">
          Scaffold a new app with the CLI, or follow the quickstart to connect
          the {frameworkName} agent you already run.
        </p>
        <DocsCode code={initCommand} lang="bash" className="my-0" />
        <Link href={quickstartHref} className={ACTION_LINK}>
          Read the quickstart
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </section>

      {connect ? (
        <section
          aria-labelledby="framework-connect"
          className="flex flex-col gap-4"
        >
          <h2 id="framework-connect" className={SECTION_TITLE}>
            Connect your agent
          </h2>
          <p className="leading-relaxed text-muted-foreground">
            {connect.intro}
          </p>
          <div className="[&>*]:my-0">
            {children ??
              (connect.code ? (
                <DocsCode
                  code={connect.code}
                  lang={connect.language}
                  title={connect.filename}
                />
              ) : null)}
          </div>
          <Link href={link(connect.guideLink)} className={ACTION_LINK}>
            Read the setup guide
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </section>
      ) : null}

      {extra ? <section>{extra}</section> : null}

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t pt-6 text-sm">
        <a
          href="https://github.com/CopilotKit/CopilotKit"
          target="_blank"
          rel="noreferrer noopener"
          className={ACTION_LINK}
        >
          View on GitHub
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </a>
        <a href="#setup" className={ACTION_LINK}>
          Start building
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}
