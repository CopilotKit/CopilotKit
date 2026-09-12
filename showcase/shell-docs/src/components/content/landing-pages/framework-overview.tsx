"use client";

import {
  ArrowRight,
  Copy,
  Check,
  ExternalLink,
  Paintbrush,
  Repeat,
  User,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import type { ReactNode } from "react";
import { usePostHog } from "posthog-js/react";

import { customIcons } from "@/components/icons";
import type { IconKey } from "@/components/icons";
import { HeroOnboardingPromptButton } from "@/components/hero-onboarding-prompt-button";
import {
  HeroStartActions,
  QuickstartLinkButton,
} from "@/components/hero-start-commands";
import { HighlightedDynamicCodeBlock } from "@/components/highlighted-dynamic-codeblock";
import { OpsPlatformCTA } from "@/components/react/ops-platform-cta";
import type {
  FrameworkOverviewData,
  OpsPlatformCTAData,
} from "@/data/frameworks/types";
import type { FrontendId } from "@/lib/frontend-options";
import { IntelligenceUpgradeSection } from "./intelligence-upgrade-section";

/**
 * Docs embeds always show the React cell. The showcase serves the same demo on
 * several frontends, and a per-frontend switcher here would duplicate the
 * control the showcase itself already has one click away.
 */
const SHOWCASE_FRONTEND = "react";
const SHOWCASE_ORIGIN = "https://showcase.copilotkit.ai";

/** The showcase page for one cell — where "Open" sends the reader. */
function showcaseDemoUrl(integration: string, demo: string): string {
  return `${SHOWCASE_ORIGIN}/${SHOWCASE_FRONTEND}/${integration}/${demo}`;
}

/**
 * The running cell itself, for the embed.
 *
 * Not the showcase page and not its `/preview` route: both render the
 * showcase's own site header, which inside our frame came out as a second
 * navigation bar in the opposite theme. This is the URL the showcase's
 * `/preview` route puts in its own iframe, so the frame here holds exactly
 * what it holds there, minus the chrome.
 *
 * The cost of going direct is that a cell which is down shows an empty frame
 * instead of the showcase's status panel — the reason to prefer an embed mode
 * on the showcase itself once one exists (`?embed=1` or equivalent), at which
 * point this function collapses back into the one above.
 *
 * The host pattern is verified per partner as its page is migrated, not
 * assumed: confirmed for mastra and langgraph-python.
 */
function showcaseCellUrl(integration: string, demo: string): string {
  return `https://showcase-${integration}-production.up.railway.app/demos/${demo}`;
}

/**
 * Icons for the capability cards. Each one is the icon the linked docs section
 * already carries in its own nav entry, so a reader meets the same mark on the
 * card and on the page it opens. An unlisted key renders no icon rather than
 * throwing, the same contract as `ctaIconFor` in the MDX registry.
 */
const CAPABILITY_ICONS: Record<string, LucideIcon> = {
  paintbrush: Paintbrush,
  repeat: Repeat,
  user: User,
  wrench: Wrench,
};

function capabilityIconFor(
  iconKey: string | undefined,
): LucideIcon | undefined {
  if (!iconKey || !Object.hasOwn(CAPABILITY_ICONS, iconKey)) return undefined;
  return CAPABILITY_ICONS[iconKey];
}

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
  /**
   * Pre-rendered code block for the "Connect your agent" section, used by the
   * authored-MDX path in place of `data.connect.code`.
   *
   * Authored pages supply a normal fenced code block, which reaches the page
   * through rehype-code and `MdxCodeBlock` like every other fence in the docs.
   * A multi-line template literal in a JSX attribute does not survive the MDX
   * pipeline intact — every line came out two spaces short, so object
   * properties sat flush with the object that contained them. Data records,
   * which never pass through MDX, keep using the plain string.
   */
  connectSnippet?: ReactNode;
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
  frontendOverride,
  afterFeatures,
  iconOverride,
  connectSnippet,
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
    lede,
    capabilitiesFootnote,
    connect,
    showcase,
  } = data;

  // `lede` is the switch between the two layouts. A record that has it gets the
  // capability cards, the connect snippet and the showcase embed; a record that
  // does not keeps the video-per-feature list, the architecture diagram and the
  // old demo iframes. Both are complete pages — the partner pages are migrated
  // one file at a time, and no page is ever left half-built in the branch.
  const useCapabilityLayout = Boolean(lede);
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

  // Frameworks whose init is the generic top-level command get the shared hero
  // action row (matching the home hero). Frameworks with bespoke setup keep
  // their own single command chip, because those commands aren't
  // interchangeable with the CLI's generic one: a2a clones a repository, and
  // the Claude Agent SDK records pass `init --framework claude-sdk-*`.
  const isGenericInit = initCommand.trim() === "npx copilotkit@latest init";

  const [activeDemo, setActiveDemo] = useState<string>(
    liveDemos[0]?.type || "saas",
  );
  const [activeShowcaseDemo, setActiveShowcaseDemo] = useState<string>(
    showcase?.demos[0]?.slug ?? "",
  );
  const [copied, setCopied] = useState(false);
  const [connectCopied, setConnectCopied] = useState(false);
  const posthog = usePostHog();
  const selectedFrontend = frontendOverride ?? "react";
  const overviewPath = hrefPrefix ?? `/${currentFramework}`;

  const captureJourneyContinuation = (
    destinationType: "demo" | "quickstart",
    destinationPath: string,
  ) => {
    try {
      posthog?.capture("docs.journey_continued", {
        destination_type: destinationType,
        destination_path: destinationPath,
        frontend: selectedFrontend,
        backend: currentFramework,
        from_path: overviewPath,
      });
    } catch {
      // Analytics must never block a docs journey.
    }
  };

  // Look up the icon by key. If the key isn't registered (forward-compat with
  // string IconKey from Track A), fall back to rendering nothing rather than
  // crashing — the framework name still appears next to it.
  const IconComponent = customIcons[iconKey as IconKey];
  const hasIcon = Boolean(iconOverride || IconComponent);

  const handleCopyConnectCommand = async () => {
    if (!connect?.initCommand) return;
    try {
      await navigator.clipboard.writeText(connect.initCommand);
      setConnectCopied(true);
      setTimeout(() => setConnectCopied(false), 2000);
    } catch (err) {
      // Same failure modes as the hero copy button below — never flip the
      // indicator on a rejected write.
      console.error(
        "[framework-overview] clipboard write failed; connect copy button no-op",
        err,
      );
    }
  };

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
        frontend={selectedFrontend}
        backend={currentFramework}
        fromPath={overviewPath}
      />
    ) : null);

  // Records and authored files that serve several slugs name one showcase
  // integration plus a per-slug map, so /langgraph-typescript embeds the
  // TypeScript cell rather than the Python one it shares a record with.
  const showcaseIntegration =
    showcase?.integrationBySlug?.[currentFramework] ?? showcase?.integration;

  const activeDemoData = liveDemos.find((demo) => demo.type === activeDemo);

  return (
    <div className={`relative ${useCapabilityLayout ? "pb-12" : "pb-24"}`}>
      <div className="relative z-10">
        {/* =========================================================
             HERO
             ========================================================= */}
        {/* One rhythm for the whole page in the capability layout: the hero
            ends where it ends, and every section below opens with the same
            `mt-12`. The legacy layout keeps its own larger spacing because its
            sections are full-width media blocks. */}
        <header className={useCapabilityLayout ? "" : "pb-8 sm:pb-12"}>
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
              hero, with the coding-agent prompt primary and Quickstart
              secondary. The prompt is identical on every surface: the CLI's
              onboarding graph inspects the repository and picks its own path,
              so a framework-scoped variant would be a promise the CLI does not
              keep. The quickstart slot is a direct link here because a
              framework is already selected. Frameworks with bespoke setup
              (e.g. the Claude Agent SDK's `init --framework`) lead with the
              same prompt and Quickstart, then keep their own copy-command chip
              as a third action: that command is not interchangeable with the
              generic CLI one, and nothing else on the page carries it.

              In the capability layout the bespoke command is not here at all —
              it moved into "Connect your agent", beside the runtime snippet it
              belongs to. A third chip in the hero made the reader choose
              between three actions before the page had told them anything. */}
          <div className="mt-7">
            {isGenericInit || useCapabilityLayout ? (
              <HeroStartActions
                prompt={
                  <HeroOnboardingPromptButton
                    surface="docs_framework_hero"
                    framework={{
                      slug: currentFramework,
                      name: frameworkName,
                    }}
                  />
                }
                quickstart={
                  <QuickstartLinkButton
                    href={link(rawGuideLink)}
                    frontend={selectedFrontend}
                    backend={currentFramework}
                    fromPath={overviewPath}
                    variant="secondary"
                  />
                }
              />
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <HeroOnboardingPromptButton
                  surface="docs_framework_hero"
                  framework={{
                    slug: currentFramework,
                    name: frameworkName,
                  }}
                />
                <QuickstartLinkButton
                  href={link(rawGuideLink)}
                  frontend={selectedFrontend}
                  backend={currentFramework}
                  fromPath={overviewPath}
                  variant="secondary"
                />
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

          {/* No caption under the action row. A line explaining what the
              button above it does is the page talking about itself, and it was
              carrying a point the page already makes better elsewhere: that
              CopilotKit goes into a project that already exists. The subheader
              says it ("<Framework> runs your agents, CopilotKit gives them a
              surface"), and "Connect your agent" shows it. */}
        </header>

        {/* =========================================================
             WHAT COPILOTKIT ADDS — one card per capability

             Card chrome, grid and typography follow
             <IntelligenceFeatureCards>, the docs' own landing block, so the
             two card sections on this page read as the same kind of thing.
             The framework-specific half of each capability opens its body
             text: an earlier revision set it on its own line above the title,
             where it read as a stray fragment rather than as the start of the
             explanation.
             ========================================================= */}
        {useCapabilityLayout && supportedFeatures.length > 0 && (
          <section className="not-prose shell-docs-landing-section mt-10 border-t border-[var(--border)] pt-10">
            <h2 className="font-semibold">What CopilotKit adds</h2>
            <p className="mt-3 text-[var(--text-muted)]">{lede}</p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {supportedFeatures.map((feature) => {
                const Icon = capabilityIconFor(feature.iconKey);
                return (
                  <article
                    key={feature.title}
                    className="shell-docs-radius-surface border border-[var(--border)] bg-[var(--bg-surface)] px-5 pb-5 pt-4 shadow-[var(--shadow-panel)]"
                  >
                    <h3 className="flex items-center gap-2 font-semibold">
                      {Icon && (
                        <Icon
                          className="size-[1em] shrink-0 text-[var(--accent)]"
                          aria-hidden="true"
                        />
                      )}
                      <span>{feature.title}</span>
                    </h3>
                    <p className="mt-3 text-[var(--text-muted)]">
                      {feature.description}
                    </p>
                    <Link
                      href={link(feature.documentationLink)}
                      className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--accent)] no-underline hover:brightness-110"
                    >
                      {feature.title} with {frameworkName}
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </article>
                );
              })}

              {/* Fourth cell, so three capabilities do not sit in a two-column
                  grid with a hole beside them. Dashed and unfilled: it is the
                  way out of the section, not a fourth capability competing
                  with the three. */}
              {capabilitiesFootnote && (
                <Link
                  href={link(capabilitiesFootnote.href)}
                  className="shell-docs-radius-surface group flex flex-col border border-dashed border-[var(--border)] px-5 pb-5 pt-4 no-underline transition-colors hover:border-[var(--accent)]"
                >
                  <span className="text-base font-semibold text-[var(--text)]">
                    {capabilitiesFootnote.linkLabel}
                  </span>
                  <span className="mt-3 text-[15px] leading-[1.65] text-[var(--text-muted)]">
                    {capabilitiesFootnote.text}
                  </span>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--accent)]">
                    Browse them all
                    <ArrowRight
                      className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                </Link>
              )}
            </div>
          </section>
        )}

        {/* =========================================================
             INTELLIGENCE — shared across every partner page
             ========================================================= */}
        {useCapabilityLayout && (
          <IntelligenceUpgradeSection
            frameworkName={frameworkName}
            frameworkSlug={currentFramework}
            link={link}
          />
        )}

        {/* =========================================================
             CONNECT YOUR AGENT — the one snippet on the page
             ========================================================= */}
        {connect && (
          <section className="not-prose shell-docs-landing-section mt-10 border-t border-[var(--border)] pt-10">
            <h2 className="font-semibold">Connect your agent</h2>
            <p className="mt-3 text-[var(--text-muted)]">{connect.intro}</p>

            {/* The same Shiki-highlighted block the rest of the docs uses.
                A hand-rolled <pre> rendered grey here and, inside the prose
                container, picked up a border on every line. */}
            {/* Not every partner has a documented snippet: a2a is set up by
                cloning a repository, so its section carries the command and the
                guide link and no code frame at all. Rendering an empty frame
                would be worse than rendering none. */}
            {(connectSnippet || connect.code) && (
              <div className="mt-5">
                {connectSnippet ?? (
                  <HighlightedDynamicCodeBlock
                    lang={connect.language ?? "ts"}
                    code={connect.code!}
                    codeblock={{ title: connect.filename }}
                  />
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link
                href={link(connect.guideLink)}
                className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--accent)] no-underline hover:brightness-110"
              >
                Full quickstart
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
              {connect.initCommand && (
                <button
                  type="button"
                  onClick={handleCopyConnectCommand}
                  className="shell-docs-radius-control group inline-flex h-9 max-w-full cursor-pointer items-center gap-3 border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-[var(--text)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--bg-elevated)]"
                  aria-label="Copy setup command"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-[var(--accent)] opacity-70">
                      $
                    </span>
                    <span className="truncate font-mono text-[12.5px] text-[var(--text-secondary)] group-hover:text-[var(--text)]">
                      {connect.initCommand}
                    </span>
                  </span>
                  <span className="shrink-0 text-[var(--text-muted)] group-hover:text-[var(--text)]">
                    {connectCopied ? (
                      <Check className="h-3.5 w-3.5 text-[var(--accent)]" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </span>
                </button>
              )}
            </div>
          </section>
        )}
        {/* =========================================================
             SUPPORTED FEATURES — legacy video-per-feature list, kept for
             records that have no `lede` yet
             ========================================================= */}
        {!useCapabilityLayout && supportedFeatures.length > 0 && (
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
                            onClick={() =>
                              captureJourneyContinuation(
                                "demo",
                                link(feature.demoLink!),
                              )
                            }
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

             Legacy only. In the capability layout this slot is what
             <IntelligenceUpgradeSection> replaced: every record's cta was a
             variation on "move to Intelligence", and keeping both would state
             the same offer twice on one page.
             ========================================================= */}
        {!useCapabilityLayout && resolvedAfterFeatures && (
          <section className="mb-20 sm:mb-28">{resolvedAfterFeatures}</section>
        )}

        {/* =========================================================
             ARCHITECTURE — legacy only
             ========================================================= */}
        {!useCapabilityLayout && (architectureImage || architectureVideo) && (
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
             SEE IT IN ACTION — showcase cells

             Replaces the old iframes, which pointed at one-off Vercel
             deployments (examples-coagents-*.vercel.app) and at
             feature-viewer.copilotkit.ai, the retired dojo. The showcase runs
             the same demo per integration and frontend and is the surface the
             team actually maintains.
             ========================================================= */}
        {showcase && showcase.demos.length > 0 && (
          <section className="not-prose shell-docs-landing-section mt-10 border-t border-[var(--border)] pt-10">
            <h2 className="font-semibold">See it in action</h2>
            <p className="mt-3 text-[var(--text-muted)]">{showcase.intro}</p>

            {/* Demo picker above the frame, so the reader chooses before the
                embed loads rather than discovering the choice underneath it. */}
            {showcase.demos.length > 1 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {showcase.demos.map((demo) => {
                  const active = demo.slug === activeShowcaseDemo;
                  return (
                    <button
                      key={demo.slug}
                      type="button"
                      onClick={() => {
                        setActiveShowcaseDemo(demo.slug);
                        captureJourneyContinuation(
                          "demo",
                          showcaseDemoUrl(showcaseIntegration!, demo.slug),
                        );
                      }}
                      className={`shell-docs-radius-control h-8 border px-3 text-[13px] font-medium transition-colors ${
                        active
                          ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--text)]"
                          : "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
                      }`}
                      aria-pressed={active}
                    >
                      {demo.title}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="shell-docs-radius-surface mt-4 overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]">
              {/* Address bar. The URL is the honest label for an embed of
                  someone else's page, and it doubles as the way out to the
                  full demo. `min-w-0` plus truncation on the URL is what keeps
                  the "Open" link inside the frame at 375px — without it the
                  link was pushed ~90px past the right edge. */}
              <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-[var(--text-muted)]">
                  {showcaseDemoUrl(showcaseIntegration!, activeShowcaseDemo)
                    .replace("https://", "")
                    .replace(/\/$/, "")}
                </span>
                <a
                  href={showcaseDemoUrl(
                    showcaseIntegration!,
                    activeShowcaseDemo,
                  )}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() =>
                    captureJourneyContinuation(
                      "demo",
                      showcaseDemoUrl(showcaseIntegration!, activeShowcaseDemo),
                    )
                  }
                  className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-[var(--accent)] no-underline hover:brightness-110"
                >
                  Open
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
              {/* `allow` and `sandbox` mirror what the showcase's own preview
                  route grants these cells: the demo is a full application that
                  needs scripts and its own origin, and the chat surfaces need
                  clipboard access to be usable. */}
              {/* `bg-[var(--bg-elevated)]` is the loading state: an iframe
                  paints white until its document arrives, which flashed a
                  full-width white panel into a dark page on every demo
                  switch. */}
              <iframe
                src={showcaseCellUrl(showcaseIntegration!, activeShowcaseDemo)}
                className="block h-[480px] w-full bg-[var(--bg-elevated)] sm:h-[600px]"
                title={`${frameworkName} showcase demo`}
                allow="clipboard-read; clipboard-write; microphone"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            </div>
          </section>
        )}

        {/* =========================================================
             LIVE DEMOS — legacy only
             ========================================================= */}
        {!useCapabilityLayout && liveDemos.length > 0 && (
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
                      onClick={() => {
                        setActiveDemo(demo.type);
                        captureJourneyContinuation("demo", demo.iframeUrl);
                      }}
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
