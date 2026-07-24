"use client";

import { ArrowRight, Copy, Check, ExternalLink } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import type { ReactNode } from "react";

import { customIcons } from "@/components/icons";
import type { IconKey } from "@/components/icons";
import {
  HeroStartActions,
  QuickstartLinkButton,
} from "@/components/hero-start-commands";
import { OpsPlatformCTA } from "@/components/react/ops-platform-cta";
import type {
  FrameworkOverviewData,
  OpsPlatformCTAData,
} from "@/data/frameworks/types";
import type { FrontendId } from "@/lib/frontend-options";

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
   * Optional public route prefix for nested docs surfaces such as
   * `/angular/langgraph-python`. Framework links are rewritten into this
   * prefix after variant normalization.
   */
  hrefPrefix?: string;
  /** Frontend selected by the route, used for framework-sensitive copy. */
  frontendOverride?: FrontendId;
  /**
   * Optional slot rendered between the supported-features section and the
   * architecture section. When supplied, this takes precedence over `data.cta`
   * (which is the structured fallback). Routes that pre-render
   * `after-features.mdx` should pass the compiled MDX here.
   */
  afterFeatures?: ReactNode;
  /**
   * Optional override for the framework icon. Takes precedence over the
   * `iconKey` lookup in `data.iconKey`. Used by the MDX adapter
   * (`MdxFrameworkOverview`) so authored `index.mdx` files can pass a
   * concrete `<XIcon />` JSX node instead of having to use a registered
   * iconKey. When supplied, `data.iconKey` is ignored.
   */
  iconOverride?: ReactNode;
}

/**
 * Swap the framework slug embedded in a URL for the user's currently selected
 * variant. Applied to both in-app internal paths and feature-viewer external
 * URLs (which encode the framework slug as a path segment).
 */
function rewriteHref(href: string, fromSlug: string, toSlug: string): string {
  if (!fromSlug || fromSlug === toSlug) return href;
  if (href === `/${fromSlug}`) return `/${toSlug}`;
  if (href.startsWith(`/${fromSlug}/`)) {
    return `/${toSlug}${href.slice(fromSlug.length + 1)}`;
  }
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

/**
 * Section eyebrow — small sans-serif label with a hairline rule. Dropped
 * the prior monospace + wide-tracking treatment because it read as
 * editorial pastiche on a developer-docs surface.
 */
function SectionEyebrow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <span className="text-sm font-medium text-[var(--text-secondary)] whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-[var(--border)]" />
    </div>
  );
}

// Docs framework slug -> the `copilotkit` CLI's own `--framework` value. The
// CLI uses different identifiers than our docs slugs, so the create command on
// a framework page only pre-selects a framework when there's a verified 1:1
// template match (values confirmed against the CLI's AGENT_FRAMEWORKS enum).
// Slugs intentionally omitted fall back to a bare `npx copilotkit create`:
//   - crewai-crews: the CLI ships "CrewAI Flows" (`flows`), not Crews — different
//   - langgraph-fastapi, claude-sdk-*, langroid, ms-agent-harness-dotnet,
//     spring-ai, agent-spec, deepagents: no matching CLI template
const DOCS_SLUG_TO_CLI_FRAMEWORK: Record<string, string> = {
  "langgraph-python": "langgraph-py",
  "langgraph-typescript": "langgraph-js",
  "google-adk": "adk",
  strands: "aws-strands-py",
  "ms-agent-dotnet": "microsoft-agent-framework-dotnet",
  "ms-agent-python": "microsoft-agent-framework-py",
  mastra: "mastra",
  "pydantic-ai": "pydantic-ai",
  llamaindex: "llamaindex",
  agno: "agno",
  ag2: "ag2",
};

export function FrameworkOverview({
  data,
  currentFramework,
  hrefPrefix,
  frontendOverride,
  afterFeatures,
  iconOverride,
}: FrameworkOverviewProps) {
  const {
    frameworkName,
    iconKey,
    header,
    subheader,
    guideLink: rawGuideLink,
    initCommand,
    supportedFeatures: rawSupportedFeatures = [],
    architectureImage,
    architectureVideo,
    liveDemos = [],
    cta,
  } = data;
  const supportedFeatures =
    frontendOverride === "angular"
      ? rawSupportedFeatures.map((feature) => ({
          ...feature,
          description: feature.description.replace(
            /\bReact components?\b/g,
            (match) =>
              match.endsWith("s")
                ? "Angular components"
                : "an Angular component",
          ),
        }))
      : rawSupportedFeatures;

  // Derive the primary variant's slug from the data record's own links —
  // typically the path segment after the leading `/` of `guideLink`
  // (e.g. "/langgraph/quickstart" → "langgraph"). This is the slug we
  // rewrite *away from* so that variant users land on their own variant's
  // sub-pages.
  const fromSlug = rawGuideLink.split("/")[1] ?? "";
  const link = (href: string) => {
    const rewritten = rewriteHref(href, fromSlug, currentFramework);
    if (!hrefPrefix || !rewritten.startsWith("/")) return rewritten;

    const frameworkPrefix = `/${currentFramework}`;
    if (rewritten === frameworkPrefix) return hrefPrefix;
    if (rewritten.startsWith(`${frameworkPrefix}/`)) {
      return `${hrefPrefix}${rewritten.slice(frameworkPrefix.length)}`;
    }
    return rewritten;
  };

  // Frameworks whose init is the generic top-level command get the unified
  // two-command recommendation (matching the home hero). Frameworks with
  // bespoke setup (e.g. a2a's `git clone`, ms-agent-dotnet) keep their own
  // single command chip — those commands aren't interchangeable with the CLI.
  const isGenericInit = initCommand.trim() === "npx copilotkit@latest init";
  const createFramework = DOCS_SLUG_TO_CLI_FRAMEWORK[currentFramework];

  const [activeDemo, setActiveDemo] = useState<string>(
    liveDemos[0]?.type || "saas",
  );
  const [copied, setCopied] = useState(false);

  // Look up the icon by key. If the key isn't registered (forward-compat with
  // string IconKey from Track A), fall back to rendering nothing rather than
  // crashing — the framework name still appears next to it.
  const IconComponent = customIcons[iconKey as IconKey];
  const hasIcon = Boolean(iconOverride || IconComponent);

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(initCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // clipboard.writeText rejects in non-secure contexts (http://),
      // when the document isn't focused, or when the user has denied
      // permission. Don't flip the "copied" indicator on failure — the
      // user would see a checkmark and paste an empty/stale buffer.
      console.error(
        "[framework-overview] clipboard write failed; copy button no-op",
        err,
      );
    }
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

  const activeDemoData = liveDemos.find((demo) => demo.type === activeDemo);

  return (
    <div className="relative pb-24">
      <div className="relative z-10">
        {/* =========================================================
             HERO
             ========================================================= */}
        <header className="pb-8 sm:pb-12">
          {/* Framework identity: icon + name in a horizontal lockup. */}
          <div className="flex items-center gap-3 mb-5">
            {hasIcon && (
              <div className="shell-docs-radius-icon flex h-10 w-10 items-center justify-center border border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]">
                {iconOverride ??
                  (IconComponent ? (
                    <IconComponent className="h-6 w-6" />
                  ) : null)}
              </div>
            )}
            <span className="text-base font-semibold tracking-tight text-[var(--text)]">
              {frameworkName}
            </span>
          </div>

          {/* Headline + supporting copy — tightened from the prior
              display-scale type. Still left-aligned with balanced wrap. */}
          <h1 className="text-[1.75rem] sm:text-[2.25rem] md:text-[2.5rem] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--text)] text-balance max-w-[24ch]">
            {header}
          </h1>
          <p className="mt-4 max-w-[58ch] text-base sm:text-lg text-[var(--text-muted)] leading-[1.55] text-pretty">
            {subheader}
          </p>

          {/* Action cluster — the same <HeroStartActions> block as the home
              hero, with Quickstart primary and the agent CLI setup menu
              secondary. The quickstart slot is a direct link here because a
              framework is already selected. Frameworks with bespoke setup
              (e.g. a2a's `git clone`, ms-agent-dotnet) keep their own
              copy-command chip because those commands aren't interchangeable
              with the CLI. */}
          <div className="mt-7">
            {isGenericInit ? (
              <HeroStartActions
                createFramework={createFramework}
                quickstart={<QuickstartLinkButton href={link(rawGuideLink)} />}
              />
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <QuickstartLinkButton href={link(rawGuideLink)} />
                <button
                  type="button"
                  onClick={handleCopyCommand}
                  className="shell-docs-radius-control group inline-flex h-11 w-full cursor-pointer items-center justify-between gap-3 border border-[var(--border)] bg-[var(--bg-surface)] px-4 text-[var(--text)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--bg-elevated)] sm:w-auto sm:justify-start"
                  aria-label="Copy install command"
                >
                  <span className="flex items-center gap-2 text-[13.5px]">
                    <span className="text-[var(--accent)] opacity-70 font-mono">
                      $
                    </span>
                    <span className="font-mono text-[13px] text-[var(--text-secondary)] group-hover:text-[var(--text)]">
                      {initCommand}
                    </span>
                  </span>
                  <span className="text-[var(--text-muted)] group-hover:text-[var(--text)]">
                    {copied ? (
                      <Check className="h-4 w-4 text-[var(--accent)]" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </span>
                </button>
              </div>
            )}
          </div>
        </header>

        {/* =========================================================
             SUPPORTED FEATURES — numbered milestone list
             ========================================================= */}
        {supportedFeatures.length > 0 && (
          <section className="mb-20 sm:mb-28">
            <SectionEyebrow label="What you can build" />
            <div className="mb-12 max-w-[58ch]">
              <h2 className="text-[2rem] sm:text-[2.5rem] font-semibold tracking-[-0.02em] leading-[1.1] text-[var(--text)]">
                Build with {frameworkName}
              </h2>
              <p className="mt-3 text-[15px] sm:text-base text-[var(--text-muted)] leading-relaxed">
                The user-facing primitives every {frameworkName} integration
                ships with — pick the one that fits your product and drop the
                code in.
              </p>
            </div>

            <div className="flex flex-col gap-16 sm:gap-24">
              {supportedFeatures.map((feature) => {
                const hasMedia = Boolean(feature.videoUrl);
                return (
                  <article
                    key={feature.title}
                    className="grid lg:grid-cols-12 gap-8 lg:gap-12 items-start"
                  >
                    {/* Left column: title + description + links */}
                    <div className="lg:col-span-5">
                      <h3 className="text-[1.5rem] sm:text-[1.75rem] font-semibold tracking-[-0.015em] leading-[1.15] text-[var(--text)]">
                        {feature.title}
                      </h3>
                      <p className="mt-3 text-[15px] text-[var(--text-muted)] leading-[1.6]">
                        {feature.description}
                      </p>

                      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
                        <Link
                          href={link(feature.documentationLink)}
                          className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--accent)] hover:text-[var(--accent)] hover:brightness-110 no-underline group"
                        >
                          Read the docs
                          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                        {feature.demoLink && (
                          <Link
                            href={link(feature.demoLink)}
                            className="inline-flex items-center gap-1.5 text-[14px] text-[var(--text-muted)] hover:text-[var(--text)] no-underline transition-colors"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Live demo
                          </Link>
                        )}
                      </div>
                    </div>

                    {/* Right column: video. If no media, the left column
                        spans wider and we leave the right empty (graceful
                        fallback for sparse data records). */}
                    {hasMedia && (
                      <div className="lg:col-span-7">
                        <div className="shell-docs-radius-surface relative overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]">
                          <video
                            src={feature.videoUrl}
                            className="w-full block"
                            autoPlay
                            muted
                            loop
                            playsInline
                          />
                          <div
                            aria-hidden
                            className="shell-docs-radius-surface pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/5"
                          />
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {/* =========================================================
             AFTER FEATURES (CTA or MDX escape hatch)
             ========================================================= */}
        {resolvedAfterFeatures && (
          <section className="mb-20 sm:mb-28">{resolvedAfterFeatures}</section>
        )}

        {/* =========================================================
             ARCHITECTURE
             ========================================================= */}
        {(architectureImage || architectureVideo) && (
          <section className="mb-20 sm:mb-28">
            <SectionEyebrow label="How it fits together" />
            <div className="mb-10 max-w-[58ch]">
              <h2 className="text-[2rem] sm:text-[2.5rem] font-semibold tracking-[-0.02em] leading-[1.1] text-[var(--text)]">
                Architecture
              </h2>
              <p className="mt-3 text-[15px] sm:text-base text-[var(--text-muted)] leading-relaxed">
                The shape of a CopilotKit + {frameworkName} application — from
                your UI down to the agent runtime.
              </p>
            </div>
            <div className="shell-docs-radius-surface overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]">
              {architectureImage && (
                <Image
                  src={architectureImage}
                  alt={`CopilotKit ${frameworkName} architecture diagram`}
                  height={800}
                  width={1600}
                  className="w-full h-auto block"
                />
              )}
              {architectureVideo && (
                <video
                  src={architectureVideo}
                  className="w-full block"
                  autoPlay
                  muted
                  loop
                  playsInline
                />
              )}
            </div>
          </section>
        )}

        {/* =========================================================
             LIVE DEMOS
             ========================================================= */}
        {liveDemos.length > 0 && (
          <section className="mb-20 sm:mb-28">
            <SectionEyebrow label="Live example" />
            <div className="mb-8 max-w-[58ch]">
              <h2 className="text-[2rem] sm:text-[2.5rem] font-semibold tracking-[-0.02em] leading-[1.1] text-[var(--text)]">
                Run {frameworkName} in your browser
              </h2>
              <p className="mt-3 text-[15px] sm:text-base text-[var(--text-muted)] leading-relaxed">
                Two patterns we see most often — drive a SaaS workflow, or
                collaborate on a canvas with your agent.
              </p>
            </div>

            {/* Segmented control — flat, single-row, with a moving accent
                underline. Mirrors the dojo's "view toggle" treatment but
                in a flatter style that suits a landing page. */}
            {liveDemos.length > 1 && (
              <div className="shell-docs-radius-control mb-6 inline-flex items-center gap-1 border border-[var(--border)] bg-[var(--bg-surface)] p-1 shadow-[var(--shadow-control)]">
                {liveDemos.map((demo) => {
                  const active = activeDemo === demo.type;
                  return (
                    <button
                      key={demo.type}
                      type="button"
                      onClick={() => setActiveDemo(demo.type)}
                      className={`shell-docs-radius-control h-8 px-4 text-[13px] font-medium transition-colors ${
                        active
                          ? "bg-[var(--bg-elevated)] text-[var(--text)] shadow-[var(--shadow-control)]"
                          : "bg-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
                      }`}
                    >
                      {demo.title}
                    </button>
                  );
                })}
              </div>
            )}

            {activeDemoData && (
              <p className="mb-5 text-[14.5px] text-[var(--text-muted)] leading-[1.6] max-w-[68ch]">
                {activeDemoData.description}
              </p>
            )}

            <div className="shell-docs-radius-surface relative overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]">
              {activeDemoData && (
                <iframe
                  src={activeDemoData.iframeUrl}
                  className="w-full h-[480px] sm:h-[600px] block"
                  title={`${activeDemoData.title} Demo`}
                />
              )}
              <div
                aria-hidden
                className="shell-docs-radius-surface pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/5"
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
