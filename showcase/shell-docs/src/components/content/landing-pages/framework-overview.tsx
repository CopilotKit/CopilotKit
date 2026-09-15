"use client";

import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ExternalLink,
  Paintbrush,
  Repeat,
  User,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { customIcons } from "@/components/icons";
import type { IconKey } from "@/components/icons";
import { HeroOnboardingPromptButton } from "@/components/hero-onboarding-prompt-button";
import {
  HeroStartActions,
  QuickstartLinkButton,
} from "@/components/hero-start-commands";
import { HighlightedDynamicCodeBlock } from "@/components/highlighted-dynamic-codeblock";
import { OpsPlatformCTA } from "@/components/react/ops-platform-cta";
import type { FrameworkOverviewData } from "@/data/frameworks/types";
import type { FrontendId } from "@/lib/frontend-options";
import { IntelligenceUpgradeSection } from "./intelligence-upgrade-section";
import { FrameworkVideos } from "./framework-videos";

const CAPABILITY_ICONS: Record<string, LucideIcon> = {
  paintbrush: Paintbrush,
  repeat: Repeat,
  user: User,
  wrench: Wrench,
};

export interface FrameworkOverviewProps {
  data: FrameworkOverviewData;
  currentFramework: string;
  hrefPrefix?: string;
  frontendOverride?: FrontendId;
  afterFeatures?: ReactNode;
  iconOverride?: ReactNode;
  connectSnippet?: ReactNode;
}

/** Preserve the selected backend and frontend for both authored and shared guides. */
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

export function FrameworkOverview({
  data,
  currentFramework,
  hrefPrefix,
  frontendOverride = "react",
  afterFeatures,
  iconOverride,
  connectSnippet,
}: FrameworkOverviewProps) {
  const { frameworkName, supportedFeatures, showcase } = data;
  const fromSlug = data.guideLink.split("/")[1] ?? "";
  const link = (href: string) =>
    frameworkLandingHref(href, fromSlug, currentFramework, hrefPrefix);
  const Icon = customIcons[data.iconKey as IconKey];
  const connect = data.connectBySlug?.[currentFramework] ?? data.connect;
  const integration =
    showcase?.integrationBySlug?.[currentFramework] ?? showcase?.integration;
  const demo = showcase?.demos[0];
  // The showcase owns cell availability and deployment addresses. Docs link to
  // its public route instead of reconstructing infrastructure URLs in an iframe.
  const demoUrl =
    integration && demo
      ? `https://showcase.copilotkit.ai/${frontendOverride}/${integration}/${demo.slug}`
      : data.liveDemos[0]?.iframeUrl;
  const videos = [
    ...(data.bannerVideo ? [{ title: "Overview", url: data.bannerVideo }] : []),
    ...supportedFeatures.flatMap((feature) =>
      feature.videoUrl ? [{ title: feature.title, url: feature.videoUrl }] : [],
    ),
  ];
  const extraContent =
    afterFeatures ??
    (data.cta ? (
      <OpsPlatformCTA
        variant={data.cta.variant === "banner" ? "inline" : "card"}
        title={data.cta.title}
        body={data.cta.body}
        ctaLabel={data.cta.ctaLabel}
        surface={data.cta.surface}
        frontend={frontendOverride}
        backend={currentFramework}
        fromPath={hrefPrefix ?? `/${currentFramework}`}
      />
    ) : null);

  return (
    <div className="partner-landing not-prose">
      <header className="partner-hero">
        <div className="partner-identity">
          <span className="partner-logo">
            {iconOverride ?? (Icon ? <Icon /> : null)}
          </span>
          <span>
            CopilotKit <span className="partner-plus">+</span> {frameworkName}
          </span>
        </div>
        <h1>{data.header}</h1>
        <p className="partner-summary">{data.subheader}</p>
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
        <p className="partner-prompt-help">
          Paste the prompt into your coding agent, or follow the quickstart.
        </p>
      </header>

      {(videos.length > 0 || demoUrl) && (
        <section
          className="partner-section partner-proof"
          aria-labelledby="partner-proof-title"
        >
          <div className="partner-section-heading">
            <h2 id="partner-proof-title">See it in action</h2>
            {demoUrl && (
              <a
                className="partner-text-link"
                href={demoUrl}
                target="_blank"
                rel="noreferrer"
              >
                Try live demo <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
          </div>
          {videos.length > 0 ? (
            <FrameworkVideos key={currentFramework} videos={videos} />
          ) : (
            <p>Explore {frameworkName} and CopilotKit in the live showcase.</p>
          )}
        </section>
      )}

      {supportedFeatures.length > 0 && (
        <section
          className="partner-section"
          aria-labelledby="partner-capabilities-title"
        >
          <h2 id="partner-capabilities-title">Your agent. Part of your app.</h2>
          {data.lede && <p className="partner-section-intro">{data.lede}</p>}
          <div className="partner-capabilities">
            {supportedFeatures.map((feature) => {
              const FeatureIcon =
                feature.iconKey &&
                Object.hasOwn(CAPABILITY_ICONS, feature.iconKey)
                  ? CAPABILITY_ICONS[feature.iconKey]
                  : undefined;
              return (
                <Link
                  key={feature.title}
                  href={link(feature.documentationLink)}
                  className="partner-card"
                >
                  <div className="partner-card-top">
                    {FeatureIcon && (
                      <FeatureIcon size={19} aria-hidden="true" />
                    )}
                    <ArrowRight
                      size={16}
                      className="partner-card-arrow"
                      aria-hidden="true"
                    />
                  </div>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </Link>
              );
            })}
          </div>
          {data.capabilitiesFootnote && (
            <Link
              className="partner-more partner-text-link"
              href={link(data.capabilitiesFootnote.href)}
            >
              Explore all capabilities{" "}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          )}
        </section>
      )}

      <section
        className="partner-section partner-start"
        aria-labelledby="partner-start-title"
      >
        <div className="partner-section-heading">
          <div>
            <h2 id="partner-start-title">Build your first integration</h2>
            <p className="partner-section-intro">
              {connect?.intro ??
                `Connect your ${frameworkName} agent to CopilotKit.`}
            </p>
          </div>
        </div>
        <Link
          className="partner-tutorial"
          href={link(data.tutorialLink ?? data.guideLink)}
        >
          <BookOpen size={21} aria-hidden="true" />
          <span>
            <strong>Follow the tutorial</strong>
            <span>A step-by-step guide from agent to app.</span>
          </span>
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
        {connect && (connectSnippet || connect.code || connect.initCommand) && (
          <details className="partner-code">
            <summary>
              Connection code <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className="partner-code-body">
              {connect.initCommand && (
                <HighlightedDynamicCodeBlock
                  lang="bash"
                  code={connect.initCommand}
                  codeblock={{ title: "Terminal" }}
                />
              )}
              {connectSnippet ??
                (connect.code ? (
                  <HighlightedDynamicCodeBlock
                    lang={connect.language ?? "ts"}
                    code={connect.code}
                    codeblock={{ title: connect.filename }}
                  />
                ) : null)}
              <Link
                className="partner-text-link"
                href={link(connect.guideLink)}
              >
                Full setup guide <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </details>
        )}
      </section>

      <IntelligenceUpgradeSection
        frameworkName={frameworkName}
        frameworkSlug={currentFramework}
        link={link}
      />
      {extraContent && (
        <section className="partner-section">{extraContent}</section>
      )}
      {(data.architectureImage || data.architectureVideo) && (
        <details className="partner-architecture partner-code">
          <summary>
            How CopilotKit connects to {frameworkName}
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <div className="partner-code-body">
            {data.architectureImage && (
              <Image
                src={data.architectureImage}
                alt={`CopilotKit and ${frameworkName} architecture`}
                width={1200}
                height={675}
                className="partner-architecture-image"
              />
            )}
            {data.architectureVideo && (
              <video
                src={data.architectureVideo}
                controls
                playsInline
                preload="metadata"
                className="partner-architecture-image"
              />
            )}
          </div>
        </details>
      )}
    </div>
  );
}
