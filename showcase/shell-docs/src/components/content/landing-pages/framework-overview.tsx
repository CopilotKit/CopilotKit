"use client";

import {
  ArrowRight,
  Copy,
  Check,
  PlayIcon,
  BookOpen,
  LayoutIcon,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import type { ReactNode } from "react";

import { customIcons } from "@/components/icons";
import type { IconKey } from "@/components/icons";
import { OpsPlatformCTA } from "@/components/react/ops-platform-cta";
import type {
  FrameworkOverviewData,
  OpsPlatformCTAData,
} from "@/data/frameworks/types";

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
 * Section eyebrow label + a hairline rule that fills the remaining width.
 * Mirrors the "section title with extending line" pattern from the
 * CopilotKit UI theme reference — calm editorial structure that gives
 * the page a clear chapter rhythm without competing with the headlines.
 */
function SectionEyebrow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--text-muted)] whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-[var(--border)]" />
    </div>
  );
}

export function FrameworkOverview({
  data,
  currentFramework,
  afterFeatures,
  iconOverride,
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
    liveDemos = [],
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
      {/* Hero atmosphere — single restrained accent glow behind the
          framework name + headline. Sits at zIndex 0 so all hero text
          renders cleanly on top. Subtle in light mode, more present in
          dark mode (where the page bg gives the accent room to breathe). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[480px] overflow-hidden"
      >
        <div
          className="absolute left-1/2 -translate-x-1/2 -top-40 h-[520px] w-[820px] rounded-full opacity-60 dark:opacity-50"
          style={{
            background:
              "radial-gradient(closest-side, var(--accent-light), transparent 70%)",
            filter: "blur(48px)",
          }}
        />
        <div
          className="absolute left-[8%] top-24 h-[260px] w-[260px] rounded-full opacity-40 dark:opacity-30"
          style={{
            background:
              "radial-gradient(closest-side, rgba(190, 194, 255, 0.45), transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        <div
          className="absolute right-[6%] top-44 h-[220px] w-[220px] rounded-full opacity-35 dark:opacity-25"
          style={{
            background:
              "radial-gradient(closest-side, rgba(133, 236, 206, 0.4), transparent 70%)",
            filter: "blur(60px)",
          }}
        />
      </div>

      <div className="relative z-10">
        {/* =========================================================
             HERO
             ========================================================= */}
        <header className="pt-10 sm:pt-16 pb-12 sm:pb-20">
          {/* Eyebrow: "CopilotKit / Integrations / {framework}" */}
          <div className="mb-8 flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--text-muted)]">
            <Image
              src="https://cdn.copilotkit.ai/docs/copilotkit/icons/copilotkit-color.svg"
              alt=""
              height={16}
              width={16}
              className="h-4 w-4 opacity-90"
            />
            <span>CopilotKit</span>
            <span className="text-[var(--text-faint)]">/</span>
            <span>Integrations</span>
            <span className="text-[var(--text-faint)]">/</span>
            <span className="text-[var(--text)]">{frameworkName}</span>
          </div>

          {/* Framework identity: icon + name in a horizontal lockup. Big
              enough to anchor the page, restrained enough not to compete
              with the headline below. */}
          <div className="flex items-center gap-4 mb-7">
            {hasIcon && (
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text)] shadow-sm">
                {iconOverride ??
                  (IconComponent ? (
                    <IconComponent className="h-7 w-7" />
                  ) : null)}
              </div>
            )}
            <div className="flex flex-col">
              <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-[var(--text-muted)]">
                Framework integration
              </span>
              <span className="text-2xl font-semibold tracking-tight text-[var(--text)] leading-tight">
                {frameworkName}
              </span>
            </div>
          </div>

          {/* Headline + supporting copy — left-aligned, generous size and
              leading, balanced wrap. The tracking is tight (-0.02em) which
              gives display text its premium feel. */}
          <h1 className="text-[2.75rem] sm:text-[3.25rem] md:text-[3.75rem] font-semibold leading-[1.02] tracking-[-0.025em] text-[var(--text)] text-balance max-w-[18ch]">
            {header}
          </h1>
          <p className="mt-6 max-w-[58ch] text-lg sm:text-xl text-[var(--text-muted)] leading-[1.55] text-pretty">
            {subheader}
          </p>

          {/* Action cluster: accent CTA, copy-command chip, secondary
              link. The init command sits on the same row as the buttons —
              one of the page's signature affordances ("copy and go"). */}
          <div className="mt-10 flex flex-col sm:flex-row sm:items-center gap-3">
            <Link href={guideLink} className="no-underline group">
              <button
                type="button"
                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 h-11 px-5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent)] hover:brightness-110 text-white font-medium text-[15px] transition-all shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:shadow-[0_8px_24px_-8px_var(--accent)]"
              >
                Start the quickstart
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </Link>

            <button
              type="button"
              onClick={handleCopyCommand}
              className="inline-flex w-full sm:w-auto items-center justify-between sm:justify-start gap-3 h-11 px-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text)] transition-colors group"
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

            <Link
              href={featuresLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-1 h-11 text-[14px] text-[var(--text-secondary)] hover:text-[var(--text)] font-medium no-underline transition-colors"
            >
              Live feature viewer
              <ExternalLink className="h-3.5 w-3.5 opacity-70" />
            </Link>
          </div>
        </header>

        {/* =========================================================
             BANNER VIDEO
             ========================================================= */}
        {bannerVideo && (
          <section className="mb-20 sm:mb-28">
            <div className="relative rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] shadow-[0_24px_60px_-30px_rgba(0,0,0,0.4)]">
              <video
                src={bannerVideo}
                className="w-full block"
                autoPlay
                muted
                loop
                playsInline
              />
              {/* Subtle inner glow at top to anchor the video to the
                  surface — gives the embed depth without a chunky border. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/5 rounded-2xl"
              />
            </div>
            <p className="mt-4 text-[13px] text-[var(--text-muted)] text-center">
              Starter app generated by{" "}
              <code className="font-mono text-[12.5px] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text)] border border-[var(--border-dim)]">
                {initCommand}
              </code>
            </p>
          </section>
        )}

        {/* =========================================================
             SUPPORTED FEATURES — numbered milestone list
             ========================================================= */}
        {supportedFeatures.length > 0 && (
          <section className="mb-20 sm:mb-28">
            <SectionEyebrow label="What you can build" />
            <div className="mb-12 max-w-[58ch]">
              <h2 className="text-[2rem] sm:text-[2.5rem] font-semibold tracking-[-0.02em] leading-[1.1] text-[var(--text)]">
                Capabilities that ship with {frameworkName}
              </h2>
              <p className="mt-3 text-[15px] sm:text-base text-[var(--text-muted)] leading-relaxed">
                Every {frameworkName} integration unlocks the same set of
                user-facing primitives. Pick the one that maps to your product
                and drop the code in.
              </p>
            </div>

            <div className="flex flex-col gap-16 sm:gap-24">
              {supportedFeatures.map((feature, index) => {
                const indexStr = String(index + 1).padStart(2, "0");
                const hasMedia = Boolean(feature.videoUrl);
                return (
                  <article
                    key={feature.title}
                    className="grid lg:grid-cols-12 gap-8 lg:gap-12 items-start"
                  >
                    {/* Left column: index + title + description + links */}
                    <div className="lg:col-span-5">
                      <div className="flex items-baseline gap-3 mb-4">
                        <span className="font-mono text-[12px] text-[var(--accent)] tracking-wider">
                          {indexStr}
                        </span>
                        <span className="h-px flex-1 bg-[var(--border)] mt-2 max-w-[80px]" />
                      </div>
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
                        <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] shadow-[0_18px_44px_-22px_rgba(0,0,0,0.4)]">
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
                            className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/5 rounded-xl"
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
            <div className="rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] shadow-[0_18px_44px_-22px_rgba(0,0,0,0.4)]">
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
            <SectionEyebrow label="Try it live" />
            <div className="mb-8 max-w-[58ch]">
              <h2 className="text-[2rem] sm:text-[2.5rem] font-semibold tracking-[-0.02em] leading-[1.1] text-[var(--text)]">
                Real {frameworkName} apps, running in your browser
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
              <div className="mb-6 inline-flex items-center gap-1 p-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
                {liveDemos.map((demo) => {
                  const active = activeDemo === demo.type;
                  return (
                    <button
                      key={demo.type}
                      type="button"
                      onClick={() => setActiveDemo(demo.type)}
                      className={`h-8 px-4 rounded-md text-[13px] font-medium transition-all ${
                        active
                          ? "bg-[var(--bg-elevated)] text-[var(--text)] shadow-sm"
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

            <div className="relative rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] shadow-[0_24px_60px_-30px_rgba(0,0,0,0.4)]">
              {activeDemoData && (
                <iframe
                  src={activeDemoData.iframeUrl}
                  className="w-full h-[480px] sm:h-[600px] block"
                  title={`${activeDemoData.title} Demo`}
                />
              )}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/5 rounded-2xl"
              />
            </div>
          </section>
        )}

        {/* =========================================================
             NEXT STEPS — slim numbered list, not chunky cards
             ========================================================= */}
        <section>
          <SectionEyebrow label="Where to next" />
          <div className="mb-8 max-w-[58ch]">
            <h2 className="text-[2rem] sm:text-[2.5rem] font-semibold tracking-[-0.02em] leading-[1.1] text-[var(--text)]">
              Pick a path
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 gap-px bg-[var(--border)] rounded-xl overflow-hidden border border-[var(--border)]">
            <NextStepCell
              href={guideLink}
              icon={<PlayIcon className="h-4 w-4" />}
              label="Quickstart"
              title="Ship in 5 minutes"
              description={`Wire up CopilotKit + ${frameworkName} from scratch and run your first agentic app.`}
              index="01"
            />
            <NextStepCell
              href={featuresLink}
              target="_blank"
              icon={<LayoutIcon className="h-4 w-4" />}
              label="Feature viewer"
              title="See every primitive"
              description="Interactive gallery of every feature with side-by-side code and live UI."
              index="02"
              external
            />
            {tutorialLink && (
              <NextStepCell
                href={tutorialLink}
                icon={<BookOpen className="h-4 w-4" />}
                label="Tutorial"
                title="Build an app, end to end"
                description={`Step-by-step walkthrough of a production-grade ${frameworkName} app.`}
                index="03"
                className="sm:col-span-2"
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * One row in the "Next steps" grid. Numbered, hover-elevating, with a
 * trailing arrow that nudges on hover. Background is the surface color
 * over a 1px border-color "rule" via the parent's `gap-px` pattern, so
 * the cells share clean hairlines on the inside without doubling.
 */
function NextStepCell({
  href,
  icon,
  label,
  title,
  description,
  index,
  external,
  target,
  className = "",
}: {
  href: string;
  icon: ReactNode;
  label: string;
  title: string;
  description: string;
  index: string;
  external?: boolean;
  target?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      target={target}
      rel={external ? "noopener noreferrer" : undefined}
      className={`group relative flex flex-col bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] p-7 sm:p-8 transition-colors no-underline ${className}`}
    >
      <div className="flex items-center justify-between mb-5">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)] flex items-center gap-2">
          <span className="text-[var(--accent)]">{index}</span>
          <span>{label}</span>
        </span>
        <span className="text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors">
          {external ? (
            <ExternalLink className="h-4 w-4" />
          ) : (
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          )}
        </span>
      </div>
      <div className="flex items-center gap-2.5 mb-2 text-[var(--text)]">
        <span className="opacity-60">{icon}</span>
        <h3 className="text-[1.125rem] font-semibold tracking-[-0.01em] !m-0 leading-tight">
          {title}
        </h3>
      </div>
      <p className="text-[14px] text-[var(--text-muted)] leading-[1.6]">
        {description}
      </p>
    </Link>
  );
}
