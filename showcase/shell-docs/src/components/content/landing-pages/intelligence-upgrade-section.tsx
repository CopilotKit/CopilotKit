"use client";

// <IntelligenceUpgradeSection> — the "when it goes to production" block that
// appears on every partner landing page, between what CopilotKit gives the
// user and how the agent is connected.
//
// Deliberately NOT per-framework. Intelligence is one platform, reached the
// same way from every framework: one option on the runtime the reader
// configures in "Connect your agent" below. Fifteen variants of that would
// invent differences that do not exist, and each would be one more place for
// the capability claims to drift. Only the links vary, and the caller rewrites
// those into the URL-active framework.
//
// The chrome follows <IntelligenceFeatureCards> in intelligence-overview.tsx —
// the docs' own landing block — rather than inventing a treatment. An earlier
// revision set this section on a tinted full-bleed band with a radial wash,
// which ran edge to edge past the content column and matched nothing else in
// the docs. The heading and the kite mark are what separate the platform from
// the open-source half; that is enough.

import {
  ArrowRight,
  BarChart3,
  Brain,
  MessagesSquare,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { HeroOnboardingPromptButton } from "@/components/hero-onboarding-prompt-button";
import { IntelligenceKiteIcon } from "@/components/intelligence-kite-icon";

interface IntelligenceCapability {
  icon: LucideIcon;
  title: string;
  body: string;
  cta: string;
  href: string;
}

// The four platform features, under the names the product uses for them:
// Rich Threads, User Memories, Automatic Learning, Product Analytics. Naming
// them anything else here is how a reader ends up searching the docs for a
// feature that exists under a different word.
//
// Icons and hrefs match <IntelligenceFeatureCards> on /intelligence/overview,
// so the same capability is drawn and linked the same way wherever a reader
// meets it. Product Analytics is the one without a docs page and points at the
// product site, exactly as that block does.
const CAPABILITIES: IntelligenceCapability[] = [
  {
    icon: MessagesSquare,
    title: "Rich Threads",
    body: "Keep messages, generative UI, and tool activity across reloads and devices.",
    cta: "Open the Rich Threads guide",
    href: "/threads",
  },
  {
    icon: Brain,
    title: "User Memories",
    body: "Carry durable facts and preferences across conversations, not tied to one thread.",
    cta: "Open the Memories guide",
    href: "/intelligence/memories",
  },
  {
    icon: Sparkles,
    title: "Automatic Learning",
    body: "Finished threads become Skills you review before anything is published.",
    cta: "Open the Learning guide",
    href: "/learning",
  },
  {
    icon: BarChart3,
    title: "Product Analytics",
    body: "See what your agents do and where users get value, from the same interaction data.",
    cta: "See Product Analytics",
    href: "https://www.copilotkit.ai/copilotkit-intelligence#analytics-insights",
  },
];

export interface IntelligenceUpgradeSectionProps {
  frameworkName: string;
  /** Docs registry slug of the page this section sits on. */
  frameworkSlug: string;
  /**
   * Link rewriter from the host page, so the hrefs above land on the
   * URL-active framework variant (`/langgraph-fastapi/threads`, not
   * `/threads`).
   */
  link: (href: string) => string;
}

export function IntelligenceUpgradeSection({
  frameworkName,
  frameworkSlug,
  link,
}: IntelligenceUpgradeSectionProps) {
  return (
    <section className="not-prose shell-docs-landing-section mt-10 border-t border-[var(--border)] pt-10">
      <h2 className="flex items-center gap-2.5 font-semibold">
        <IntelligenceKiteIcon className="h-[1em] w-[1em] shrink-0 text-[var(--accent)]" />
        CopilotKit Intelligence
      </h2>
      <p className="mt-3 text-[var(--text-muted)]">
        Everything above runs on your side, and it ends when the tab closes.
        Intelligence is the platform that keeps it, hosted by us or in your own
        cluster.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {CAPABILITIES.map(({ icon: Icon, title, body, cta, href }) => (
          <article
            key={title}
            className="shell-docs-radius-surface border border-[var(--border)] bg-[var(--bg-surface)] px-5 pb-5 pt-4 shadow-[var(--shadow-panel)]"
          >
            <h3 className="flex items-center gap-2 font-semibold">
              <Icon
                className="size-[1em] shrink-0 text-[var(--accent)]"
                aria-hidden="true"
              />
              <span>{title}</span>
            </h3>
            <p className="mt-3 text-[var(--text-muted)]">{body}</p>
            <Link
              href={link(href)}
              className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--accent)] no-underline hover:brightness-110"
            >
              {cta}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </article>
        ))}
      </div>

      {/* The same onboarding prompt as the hero. The CLI classifies the
          repository itself and has a path for "already on CopilotKit
          open-source", so one button serves both a first install and the move
          to Intelligence — a second, Intelligence-specific prompt would be a
          promise the CLI does not keep. */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <HeroOnboardingPromptButton
          surface="docs_framework_intelligence"
          framework={{ slug: frameworkSlug, name: frameworkName }}
        />
        <p className="shell-docs-landing-caption text-[var(--text-muted)]">
          <Link
            href={link("/intelligence/overview")}
            className="font-medium text-[var(--accent)] no-underline hover:brightness-110"
          >
            Learn more about Intelligence and its features
            <ArrowRight
              className="ml-1 inline h-3.5 w-3.5 align-[-0.15em]"
              aria-hidden="true"
            />
          </Link>
        </p>
      </div>
    </section>
  );
}
