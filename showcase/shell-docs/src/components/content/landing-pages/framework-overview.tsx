"use client";

import {
  ExternalLink,
  ArrowRight,
  Copy,
  Check,
  PlayIcon,
  BookOpen,
  LayoutIcon,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useState, type ReactNode } from "react";

import { customIcons, type IconKey } from "@/components/icons";
import { OpsPlatformCTA } from "@/components/react/ops-platform-cta";
import type {
  FrameworkOverviewData,
  OpsPlatformCTAData,
} from "@/data/frameworks/types";

// Inline button styling — avoids dragging shadcn/CVA/clsx into shell-docs
// just for a marketing surface. Matches the plain-`<button>` + inlined-
// Tailwind pattern used by `src/components/copy-button.tsx`.
const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export interface FrameworkOverviewProps {
  data: FrameworkOverviewData;
  /**
   * The framework slug from the current URL (e.g. "langgraph-typescript").
   * Used to rewrite the data record's links so they stay within the user's
   * selected variant — without this, langgraph-typescript users clicking
   * "Quickstart" land on langgraph-python's quickstart via SLUG_RENAMES,
   * because the data record's `guideLink` embeds the primary variant's slug.
   */
  currentFramework: string;
  /**
   * Optional slot rendered between the supported-features section and the
   * architecture section. When supplied, this takes precedence over `data.cta`
   * (which is the structured fallback). Routes that pre-render
   * `after-features.mdx` should pass the compiled MDX here.
   */
  afterFeatures?: ReactNode;
}

/**
 * Swap the framework slug embedded in a URL for the user's currently selected
 * variant. Applied to both in-app internal paths and feature-viewer external
 * URLs (which encode the framework slug as a path segment).
 */
function rewriteHref(href: string, fromSlug: string, toSlug: string): string {
  if (!fromSlug || fromSlug === toSlug) return href;
  // Internal paths: `/<fromSlug>` or `/<fromSlug>/...`
  if (href === `/${fromSlug}`) return `/${toSlug}`;
  if (href.startsWith(`/${fromSlug}/`)) {
    return `/${toSlug}${href.slice(fromSlug.length + 1)}`;
  }
  // feature-viewer.copilotkit.ai/<fromSlug>/...
  const featureViewerNeedle = `feature-viewer.copilotkit.ai/${fromSlug}/`;
  if (href.includes(featureViewerNeedle)) {
    return href.replace(
      featureViewerNeedle,
      `feature-viewer.copilotkit.ai/${toSlug}/`,
    );
  }
  return href;
}

/**
 * Map Track A's `OpsPlatformCTAData.variant` ("card" | "banner") onto the
 * variants supported by shell-docs's `OpsPlatformCTA` ("tile" | "inline" |
 * "card" | "info"). "banner" => "inline" preserves the full-width prominent
 * CTA intent without introducing a new variant.
 */
function ctaVariantFor(data: OpsPlatformCTAData): "card" | "inline" {
  return data.variant === "banner" ? "inline" : "card";
}

export function FrameworkOverview({
  data,
  currentFramework,
  afterFeatures,
}: FrameworkOverviewProps) {
  const {
    frameworkName,
    iconKey,
    header,
    subheader,
    bannerVideo,
    guideLink: rawGuideLink,
    initCommand,
    featuresLink: rawFeaturesLink,
    supportedFeatures = [],
    architectureImage,
    architectureVideo,
    liveDemos,
    tutorialLink: rawTutorialLink,
    cta,
  } = data;

  // Derive the primary variant's slug from the data record's own links —
  // typically the path segment after the leading `/` of `guideLink`
  // (e.g. "/langgraph/quickstart" → "langgraph"). This is the slug we
  // rewrite *away from* so that variant users land on their own variant's
  // sub-pages.
  const fromSlug = rawGuideLink.split("/")[1] ?? "";
  const link = (href: string) => rewriteHref(href, fromSlug, currentFramework);

  const guideLink = link(rawGuideLink);
  const featuresLink = link(rawFeaturesLink);
  const tutorialLink = rawTutorialLink ? link(rawTutorialLink) : undefined;

  const [activeDemo, setActiveDemo] = useState<string>(
    liveDemos[0]?.type || "saas",
  );
  const [copied, setCopied] = useState(false);

  // Look up the icon by key. If the key isn't registered (forward-compat with
  // string IconKey from Track A), fall back to rendering nothing rather than
  // crashing — the framework name still appears next to it.
  const IconComponent = customIcons[iconKey as IconKey];

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(initCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // If no explicit afterFeatures slot is supplied, render the structured cta
  // (if any) so data-driven intros still get a CTA without needing MDX.
  const resolvedAfterFeatures: ReactNode =
    afterFeatures ??
    (cta ? (
      <OpsPlatformCTA
        variant={ctaVariantFor(cta)}
        title={cta.title}
        body={cta.body}
        ctaLabel={cta.ctaLabel}
        surface={cta.surface}
      />
    ) : null);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        {/* Header with Fixed Buttons */}
        <header className="text-center mb-12 sm:mb-20">
          <div className="hidden items-center justify-center gap-4 sm:gap-8 mb-8 sm:mb-12 flex-wrap px-4 lg:flex">
            <div className="flex items-center gap-2 sm:gap-4">
              <Image
                src="https://cdn.copilotkit.ai/docs/copilotkit/icons/copilotkit-color.svg"
                alt="CopilotKit"
                height={40}
                width={40}
                className="w-8 h-8 sm:w-10 sm:h-10 flex-shrink-0"
              />
              <span className="text-2xl sm:text-3xl font-bold whitespace-nowrap">
                CopilotKit
              </span>
            </div>
            <div className="w-px h-10 sm:h-12 bg-border dark:bg-primary flex-shrink-0" />
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="flex items-center justify-center text-primary">
                {IconComponent ? <IconComponent className="h-14 w-14" /> : null}
              </div>
              <span className="text-2xl sm:text-3xl font-bold text-foreground whitespace-nowrap">
                {frameworkName}
              </span>
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-4 sm:mb-6 text-foreground tracking-wider leading-tight text-balance px-4">
            {header}
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-muted-foreground mb-8 sm:mb-12 max-w-3xl mx-auto leading-relaxed text-pretty px-4">
            {subheader}
          </p>

          <div className="flex flex-wrap lg:flex-nowrap justify-center gap-3 sm:gap-4 px-4">
            {/* Quickstart and View Features stay together on small screens */}
            <div className="flex gap-3 sm:gap-4 w-full lg:w-auto lg:contents">
              <Link
                href={guideLink}
                className="flex-1 lg:flex-none lg:w-auto lg:order-1"
              >
                <button
                  type="button"
                  className={`${BUTTON_BASE} w-full border border-input bg-background hover:bg-accent hover:text-accent-foreground px-6 sm:px-8 py-3 text-sm sm:text-base cursor-pointer`}
                >
                  Quickstart
                </button>
              </Link>
              <Link
                href={featuresLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 lg:flex-none lg:w-auto lg:order-3"
              >
                <button
                  type="button"
                  className={`${BUTTON_BASE} w-full border border-input bg-background hover:bg-accent hover:text-accent-foreground px-6 sm:px-8 py-3 text-sm sm:text-base cursor-pointer`}
                >
                  View Features
                </button>
              </Link>
            </div>
            <button
              type="button"
              onClick={handleCopyCommand}
              className={`${BUTTON_BASE} w-full lg:w-auto bg-primary/10 dark:bg-primary/20 text-primary hover:bg-primary/20 dark:hover:bg-primary/40 shadow-lg px-6 sm:px-8 py-3 text-sm sm:text-base font-mono cursor-pointer border border-primary lg:order-2`}
            >
              <span className="truncate">npx copilotkit create</span>
              {copied ? (
                <Check className="ml-2 h-4 w-4 flex-shrink-0" />
              ) : (
                <Copy className="ml-2 h-4 w-4 flex-shrink-0" />
              )}
            </button>
          </div>
        </header>

        {/* Overview Video */}
        {bannerVideo && (
          <section className="mb-12 sm:mb-24">
            <div>
              <video
                src={bannerVideo}
                className="w-full rounded-lg sm:rounded-xl border shadow-lg"
                controls
                autoPlay
                muted
                loop
                playsInline
              />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-4 text-center px-4">
              Starter app from running{" "}
              <span className="font-mono bg-primary/10 text-primary px-2 py-1 rounded-md text-xs sm:text-sm">
                {initCommand}
              </span>
              , demonstrating key features of CopilotKit with {frameworkName}.
            </p>
          </section>
        )}

        {/* Features - Only show if features are provided */}
        {supportedFeatures.length > 0 && (
          <section className="mb-12 sm:mb-24">
            <div className="mb-8 sm:mb-16 text-center px-4">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-foreground">
                Key Features
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto">
                Everything you need to build interactive, agent-powered
                applications
              </p>
              <div className="w-16 sm:w-24 h-1 bg-gradient-to-r from-primary to-primary mx-auto mt-4 sm:mt-6 rounded-full"></div>
            </div>

            <div className="space-y-12 sm:space-y-24">
              {supportedFeatures.map((feature, index) => (
                <div
                  key={feature.title}
                  className={`border-b border-border pb-12 sm:pb-24 ${index === supportedFeatures.length - 1 ? "last:border-b-0 last:pb-0" : ""}`}
                >
                  <div className="grid lg:grid-cols-5 gap-6 sm:gap-12 items-start">
                    <div className="lg:col-span-2">
                      <div className="mb-4">
                        <h3 className="text-xl sm:text-2xl font-bold mb-2 text-foreground">
                          {feature.title}
                        </h3>
                        <div className="w-10 sm:w-12 h-0.5 bg-gradient-to-r from-primary to-primary rounded-full"></div>
                      </div>
                      <p className="text-sm sm:text-base text-muted-foreground leading-relaxed mb-6">
                        {feature.description}
                      </p>
                      <div className="space-y-3">
                        <Link
                          href={link(feature.documentationLink)}
                          className="block text-primary hover:text-primary font-medium no-underline text-sm sm:text-base"
                        >
                          Learn more →
                        </Link>
                        {feature.demoLink && (
                          <Link
                            href={link(feature.demoLink)}
                            className="block text-muted-foreground hover:text-foreground text-xs sm:text-sm flex items-center gap-2 no-underline"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Live demo
                          </Link>
                        )}
                      </div>
                    </div>

                    <div className="lg:col-span-3">
                      {feature.videoUrl && (
                        <video
                          src={feature.videoUrl}
                          className="w-full rounded-lg border shadow-lg"
                          controls
                          autoPlay
                          muted
                          loop
                          playsInline
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {resolvedAfterFeatures && (
          <section className="mb-12 sm:mb-24 px-4">
            {resolvedAfterFeatures}
          </section>
        )}

        {/* Architecture */}
        {(architectureImage || architectureVideo) && (
          <section className="mb-12 sm:mb-24">
            <div className="mb-8 sm:mb-12 text-center px-4">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-foreground">
                Architecture
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto">
                Understanding how CopilotKit and {frameworkName} work together
              </p>
              <div className="w-16 sm:w-24 h-1 bg-gradient-to-r from-primary to-primary mx-auto mt-4 sm:mt-6 rounded-full"></div>
            </div>
            {architectureImage && (
              <Image
                src={architectureImage}
                alt={`CopilotKit ${frameworkName} Infrastructure Diagram`}
                height={800}
                width={1200}
                className="w-full h-auto rounded-lg sm:rounded-xl shadow-lg border"
              />
            )}
            {architectureVideo && (
              <div className="relative">
                <video
                  src={architectureVideo}
                  className="w-full rounded-lg sm:rounded-xl border shadow-lg"
                  controls
                  autoPlay
                  muted
                  loop
                  playsInline
                />
              </div>
            )}
          </section>
        )}

        {/* Live demo - Only show if demos are provided */}
        {liveDemos.length > 0 && (
          <section className="mb-12 sm:mb-24">
            <div className="mb-8 sm:mb-12 text-center px-4">
              <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-foreground">
                Live demo
              </h2>
              <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto mb-6 sm:mb-8">
                Explore different types of agent-powered applications built with
                CopilotKit and {frameworkName}.
              </p>

              {/* Demo Toggle Buttons */}
              {liveDemos.length > 1 && (
                <div className="flex flex-col sm:flex-row justify-center gap-3 sm:gap-4 mb-6 sm:mb-8">
                  {liveDemos.map((demo) => (
                    <button
                      key={demo.type}
                      type="button"
                      onClick={() => setActiveDemo(demo.type)}
                      className={`${BUTTON_BASE} px-4 sm:px-6 py-2 cursor-pointer text-sm sm:text-base ${
                        activeDemo === demo.type
                          ? "bg-primary/10 text-primary hover:bg-primary/20 shadow border border-primary"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary"
                      }`}
                    >
                      {demo.title}
                    </button>
                  ))}
                </div>
              )}

              <div className="w-16 sm:w-24 h-1 bg-gradient-to-r from-primary to-primary mx-auto mt-4 sm:mt-6 rounded-full"></div>
            </div>

            <div className="max-w-4xl mx-auto mt-6 sm:mt-8 mb-8 sm:mb-16 px-4">
              {liveDemos.find((demo) => demo.type === activeDemo) && (
                <div className="text-center">
                  <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">
                    {liveDemos.find((demo) => demo.type === activeDemo)?.title}
                  </h3>
                  <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
                    {
                      liveDemos.find((demo) => demo.type === activeDemo)
                        ?.description
                    }
                  </p>
                </div>
              )}
            </div>

            <div className="relative">
              {liveDemos.find((demo) => demo.type === activeDemo) && (
                <iframe
                  src={
                    liveDemos.find((demo) => demo.type === activeDemo)
                      ?.iframeUrl
                  }
                  className="w-full h-[400px] sm:h-[600px] rounded-lg sm:rounded-xl border shadow-lg"
                  title={`${liveDemos.find((demo) => demo.type === activeDemo)?.title} Demo`}
                />
              )}
              <div className="absolute inset-0 rounded-lg sm:rounded-xl ring-1 ring-inset ring-secondary pointer-events-none"></div>
            </div>
          </section>
        )}

        {/* Standardized Next Steps */}
        <section>
          <div className="mb-8 sm:mb-12 text-center px-4">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-foreground">
              Next Steps
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto">
              Ready to build your own agent-powered application?
            </p>
            <div className="w-16 sm:w-24 h-1 bg-gradient-to-r from-primary to-primary mx-auto mt-4 sm:mt-6 rounded-full"></div>
          </div>
          <div
            className={`grid gap-6 sm:gap-8 ${tutorialLink ? "grid-cols-1 xl:grid-cols-3" : "grid-cols-1 xl:grid-cols-2"}`}
          >
            <div className="border border-border rounded-lg p-6 sm:p-8 shadow bg-card flex flex-col justify-between">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <PlayIcon className="text-primary w-5 h-5" />
                  <h3 className="text-lg sm:text-xl font-semibold !m-0 text-foreground">
                    Quickstart
                  </h3>
                </div>
                <p className="text-sm sm:text-base text-muted-foreground mb-6 sm:mb-8 leading-relaxed">
                  Build your first agentic app with {frameworkName} in minutes.
                </p>
              </div>
              <Link href={guideLink} className="no-underline">
                <button
                  type="button"
                  className={`${BUTTON_BASE} w-full h-10 sm:h-11 text-sm sm:text-base bg-primary/10 text-primary hover:bg-primary/20 shadow border border-primary cursor-pointer`}
                >
                  Quickstart
                  <ArrowRight className="ml-2 h-4 w-4" />
                </button>
              </Link>
            </div>

            <div className="border border-border rounded-lg p-6 sm:p-8 shadow bg-card flex flex-col justify-between">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <LayoutIcon className="text-primary w-5 h-5" />
                  <h3 className="text-lg sm:text-xl font-semibold !m-0 text-foreground">
                    Feature Overview
                  </h3>
                </div>
                <p className="text-sm sm:text-base text-muted-foreground mb-6 sm:mb-8 leading-relaxed">
                  Try the key features provided to your agent by CopilotKit.
                </p>
              </div>
              <Link
                href={featuresLink}
                rel="noopener noreferrer"
                target="_blank"
                className="no-underline"
              >
                <button
                  type="button"
                  className={`${BUTTON_BASE} w-full h-10 sm:h-11 text-sm sm:text-base bg-primary/10 text-primary hover:bg-primary/20 shadow border border-primary cursor-pointer`}
                >
                  Visit feature viewer
                  <ArrowRight className="ml-2 h-4 w-4" />
                </button>
              </Link>
            </div>

            {tutorialLink && (
              <div className="border border-border rounded-lg p-6 sm:p-8 shadow bg-card flex flex-col justify-between">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <BookOpen className="text-primary w-5 h-5" />
                    <h3 className="text-lg sm:text-xl font-semibold !m-0 text-foreground">
                      Tutorial
                    </h3>
                  </div>
                  <p className="text-sm sm:text-base text-muted-foreground mb-6 sm:mb-8 leading-relaxed">
                    Step-by-step guide to building an agent-native application.
                  </p>
                </div>
                <Link href={tutorialLink} className="no-underline">
                  <button
                    type="button"
                    className={`${BUTTON_BASE} w-full h-10 sm:h-11 text-sm sm:text-base bg-primary/10 text-primary hover:bg-primary/20 shadow border border-primary cursor-pointer`}
                  >
                    Start Tutorial
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </button>
                </Link>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
