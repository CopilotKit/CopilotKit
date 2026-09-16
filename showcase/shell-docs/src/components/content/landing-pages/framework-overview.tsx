"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { usePostHog } from "posthog-js/react";
import { customIcons } from "@/components/icons";
import type { IconKey } from "@/components/icons";
import { HeroOnboardingPromptButton } from "@/components/hero-onboarding-prompt-button";
import {
  HeroStartActions,
  QuickstartLinkButton,
} from "@/components/hero-start-commands";
import { DocsVideoCarousel } from "@/components/docs-video-carousel";
import { OpsPlatformCTA } from "@/components/react/ops-platform-cta";
import type { FrameworkOverviewData } from "@/data/frameworks/types";
import type { FrontendId } from "@/lib/frontend-options";
import type { PartnerShowcaseDemo } from "@/lib/partner-showcase-demos";
import { PartnerFeatureExplorer } from "./partner-feature-explorer";
import { FrameworkVideos } from "./framework-videos";

export interface FrameworkOverviewProps {
  data: FrameworkOverviewData;
  currentFramework: string;
  hrefPrefix?: string;
  frontendOverride?: FrontendId;
  afterFeatures?: ReactNode;
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
  iconOverride,
  showcaseDemos = [],
  setupContent,
}: FrameworkOverviewProps) {
  const { frameworkName, supportedFeatures, cta } = data;
  const link = (href: string) =>
    frameworkLandingHref(
      href,
      data.guideLink.split("/")[1] ?? "",
      currentFramework,
      hrefPrefix,
    );
  const Icon = customIcons[data.iconKey as IconKey];
  const posthog = usePostHog();
  const recordings = [
    ...(data.bannerVideo ? [{ title: "Overview", url: data.bannerVideo }] : []),
    ...supportedFeatures.flatMap((feature) =>
      feature.videoUrl ? [{ title: feature.title, url: feature.videoUrl }] : [],
    ),
  ];
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
          {frameworkName} agents. Add chat, interactive UI, and human approvals.
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
        hrefPrefix={hrefPrefix ?? `/${currentFramework}`}
        frameworkName={frameworkName}
        onOpenDemo={trackDemo}
      />

      <section
        id="setup"
        className="partner-section partner-setup"
        aria-labelledby="partner-setup-heading"
      >
        <h2 id="partner-setup-heading">Start building</h2>
        <p className="partner-section-intro">
          Connect an existing agent or build a new one. Get a tailored setup
          prompt, or start with the CLI.
        </p>
        {setupContent && <div className="partner-wizard">{setupContent}</div>}
        {data.initCommand.trim() !== "npx copilotkit@latest init" && (
          <details className="partner-details">
            <summary>
              Set up from your terminal{" "}
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <pre>
              <code>{data.initCommand}</code>
            </pre>
          </details>
        )}
      </section>

      <details className="partner-details partner-section">
        <summary>
          Watch product walkthroughs{" "}
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <DocsVideoCarousel />
        {recordings.length > 0 && <FrameworkVideos videos={recordings} />}
      </details>

      {extraContent && (
        <section className="partner-section">{extraContent}</section>
      )}
      {(data.architectureImage || data.architectureVideo) && (
        <details className="partner-details partner-section">
          <summary>
            How CopilotKit connects to {frameworkName}{" "}
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          {data.architectureImage && (
            <Image
              src={data.architectureImage}
              alt={`CopilotKit and ${frameworkName} architecture`}
              width={1200}
              height={675}
              className="partner-architecture"
            />
          )}
          {data.architectureVideo && (
            <video
              src={data.architectureVideo}
              controls
              playsInline
              preload="metadata"
              className="partner-architecture"
            />
          )}
        </details>
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
