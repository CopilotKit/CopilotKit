"use client";

import { ArrowRight, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { usePostHog } from "posthog-js/react";
import { customIcons } from "@/components/icons";
import type { IconKey } from "@/components/icons";
import { HeroOnboardingPromptButton } from "@/components/hero-onboarding-prompt-button";
import {
  HeroStartActions,
  QuickstartLinkButton,
} from "@/components/hero-start-commands";
import { OpsPlatformCTA } from "@/components/react/ops-platform-cta";
import type { FrameworkOverviewData } from "@/data/frameworks/types";
import type { FrontendId } from "@/lib/frontend-options";
import type { PartnerShowcaseDemo } from "@/lib/partner-showcase-demos";
import { PartnerFeatureExplorer } from "./partner-feature-explorer";

export interface FrameworkOverviewProps {
  data: FrameworkOverviewData;
  currentFramework: string;
  hrefPrefix?: string;
  frontendOverride?: FrontendId;
  afterFeatures?: ReactNode;
  connectSnippet?: ReactNode;
  iconOverride?: ReactNode;
  showcaseDemos?: PartnerShowcaseDemo[];
  setupContent?: ReactNode;
}

/** Preserve frontend/backend context for authored aliases and shared guides. */
export function frameworkLandingHref(
  href: string,
  fromSlug: string,
  currentFramework: string,
  hrefPrefix = `/${currentFramework}`,
): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  for (const slug of [fromSlug, currentFramework].filter(Boolean)) {
    const prefix = `/${slug}`;
    if (href === prefix) return hrefPrefix;
    if (href.startsWith(`${prefix}/`))
      return `${hrefPrefix}${href.slice(prefix.length)}`;
  }
  if (
    /^\/(threads(?:[/?#-]|$)|learning(?:[/?#]|$)|intelligence(?:[/?#]|$))/.test(
      href,
    )
  )
    return `${hrefPrefix}${href}`;
  return href;
}

export function FrameworkOverview({
  data,
  currentFramework,
  hrefPrefix,
  frontendOverride = "react",
  afterFeatures,
  connectSnippet,
  iconOverride,
  showcaseDemos = [],
  setupContent,
}: FrameworkOverviewProps) {
  const { frameworkName, cta, connect, supportedFeatures = [] } = data;
  const link = (href: string) =>
    frameworkLandingHref(
      href,
      data.guideLink.split("/")[1] ?? "",
      currentFramework,
      hrefPrefix,
    );
  const Icon = customIcons[data.iconKey as IconKey];
  const posthog = usePostHog();
  const defaultCta = cta ? (
    <OpsPlatformCTA
      variant={cta.variant === "banner" ? "inline" : "card"}
      title={cta.title}
      body={cta.body}
      ctaLabel={cta.ctaLabel}
      surface={cta.surface}
      frontend={frontendOverride}
      backend={currentFramework}
      fromPath={hrefPrefix ?? `/${currentFramework}`}
    />
  ) : null;
  const extraContent =
    afterFeatures && data.preserveCtaWithAfterFeatures ? (
      <>
        {afterFeatures}
        {defaultCta}
      </>
    ) : (
      (afterFeatures ?? defaultCta)
    );
  function trackDemo(href: string) {
    try {
      posthog?.capture("docs.journey_continued", {
        destination_type: "demo",
        destination_path: href,
        frontend: frontendOverride,
        backend: currentFramework,
        from_path: hrefPrefix ?? `/${currentFramework}`,
      });
    } catch {
      /* Analytics cannot block navigation. */
    }
  }
  return (
    <div className="partner-landing not-prose">
      <header className="partner-hero">
        <div className="partner-identity">
          <span className="partner-logo">
            {iconOverride ?? (Icon ? <Icon /> : null)}
          </span>
          <span>CopilotKit + {frameworkName}</span>
        </div>
        <h1>
          Bring your {frameworkName} agents
          <br />
          <span>into any app</span>
        </h1>
        <p className="partner-summary">
          CopilotKit is an open-source framework that connects your app to{" "}
          {frameworkName} agents. Give your agents chat, generative UI,
          human-in-the-loop, Threads, Learning and more.
        </p>
        <HeroStartActions
          prompt={
            <HeroOnboardingPromptButton
              surface="docs_framework_hero"
              framework={{ slug: currentFramework, name: frameworkName }}
            />
          }
          quickstart={
            <QuickstartLinkButton
              href={link(data.guideLink)}
              variant="secondary"
              frontend={frontendOverride}
              backend={currentFramework}
              fromPath={hrefPrefix ?? `/${currentFramework}`}
            />
          }
        />
      </header>

      <PartnerFeatureExplorer
        demos={showcaseDemos}
        frameworkName={frameworkName}
        onOpenDemo={trackDemo}
      />

      {data.showcase && (
        <p className="partner-showcase-intro">{data.showcase.intro}</p>
      )}

      {supportedFeatures.length > 0 && (
        <section
          className="partner-section"
          aria-labelledby="partner-capabilities-heading"
        >
          <h2 id="partner-capabilities-heading">Build with {frameworkName}</h2>
          <p className="partner-section-intro">
            {data.lede ??
              `Add the user-facing capabilities your ${frameworkName} agents need.`}
          </p>
          <div className="partner-capabilities">
            {supportedFeatures.map((feature) => (
              <article key={feature.title} className="partner-capability">
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
                <Link href={link(feature.documentationLink)}>
                  Read the docs <ArrowRight size={14} aria-hidden="true" />
                </Link>
                {feature.demoLink && (
                  <Link
                    href={link(feature.demoLink)}
                    onClick={() => trackDemo(link(feature.demoLink!))}
                  >
                    Live demo <ExternalLink size={14} aria-hidden="true" />
                  </Link>
                )}
              </article>
            ))}
          </div>
          {data.capabilitiesFootnote && (
            <p className="partner-capabilities-footnote">
              {data.capabilitiesFootnote.text}{" "}
              <Link href={link(data.capabilitiesFootnote.href)}>
                {data.capabilitiesFootnote.linkLabel}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </p>
          )}
        </section>
      )}

      <section
        id="setup"
        className="partner-section partner-setup"
        aria-labelledby="partner-setup-heading"
      >
        <h2 id="partner-setup-heading">Start building</h2>
        <p className="partner-section-intro">
          Connect an existing agent or build a new one. Get a tailored setup
          prompt.
        </p>
        {setupContent && <div className="partner-wizard">{setupContent}</div>}
      </section>

      {connect && (
        <section
          className="partner-section"
          aria-labelledby="partner-connect-heading"
        >
          <h2 id="partner-connect-heading">Connect your agent</h2>
          <p className="partner-section-intro">{connect.intro}</p>
          <div className="partner-connect-snippet">
            {connectSnippet ??
              (connect.code && (
                <pre>
                  <code>{connect.code}</code>
                </pre>
              ))}
          </div>
          <Link className="partner-connect-link" href={link(connect.guideLink)}>
            Read the setup guide <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </section>
      )}

      {extraContent && (
        <section className="partner-section">{extraContent}</section>
      )}
      <footer className="partner-footer">
        <a
          href="https://github.com/CopilotKit/CopilotKit"
          target="_blank"
          rel="noreferrer"
        >
          View on GitHub
        </a>
        <a href="#setup">
          Start building <ArrowRight size={16} aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}
const DOCS_SLUG_TO_CLI_FRAMEWORK: Record<string, string> = {
  "langgraph-python": "langgraph-py",
  "langgraph-typescript": "langgraph-js",
  "google-adk": "adk",
  strands: "aws-strands-py",
  "strands-typescript": "aws-strands-ts",
  "ms-agent-dotnet": "microsoft-agent-framework-dotnet",
  "ms-agent-python": "microsoft-agent-framework-py",
  mastra: "mastra",
  "pydantic-ai": "pydantic-ai",
  llamaindex: "llamaindex",
  agno: "agno",
  ag2: "ag2",
};

export function cliFrameworkForDocsSlug(slug: string): string | undefined {
  return DOCS_SLUG_TO_CLI_FRAMEWORK[slug];
}
