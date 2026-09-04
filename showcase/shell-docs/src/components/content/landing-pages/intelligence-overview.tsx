"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  MessagesSquare,
  Server,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { OnboardingPromptButton } from "@/components/onboarding-prompt-button";
import {
  HeroStartActions,
  QuickstartLinkButton,
} from "@/components/hero-start-commands";

export const INTELLIGENCE_SIZZLE_VIDEO_URL =
  "https://github.com/user-attachments/assets/72b7b4f3-b6e7-460c-a932-5746fe3c8db3";

const CONNECT_HREF = "/intelligence/quickstart";

/**
 * This landing page's own URL. The page sets `hidePageActions` in its
 * frontmatter, so no page-tools row computes the `.mdx` URL for it — the hero
 * names the page itself, off the same constant the analytics `fromPath` uses,
 * so the two cannot drift apart.
 */
const OVERVIEW_PATH = "/intelligence/overview";

const FEATURES = [
  {
    title: "Rich Threads",
    body: "Keep messages, generative UI, and tool activity across reloads and devices.",
    href: "/threads",
    cta: "Open the Rich Threads guide",
    icon: MessagesSquare,
  },
  {
    title: "Analytics",
    body: "See what your agents do and where users get value, from the same interaction data.",
    href: "https://www.copilotkit.ai/copilotkit-intelligence#analytics-insights",
    cta: "See Analytics on the product page",
    icon: BarChart3,
  },
  {
    title: "Automatic Learning",
    body: "Agents improve from real usage. No fine-tuning pipeline required.",
    href: "https://www.copilotkit.ai/copilotkit-intelligence#self-improvement",
    cta: "See Automatic Learning on the product page",
    icon: Sparkles,
  },
  {
    title: "Self-hosting",
    body: "Run the same platform in your own cluster, VPC, or data boundary.",
    href: "/intelligence/self-hosting",
    cta: "Open the self-hosting guide",
    icon: Server,
  },
] as const;

function SizzleVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (typeof window.matchMedia !== "function") return;

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");

    function applyReducedMotion(reduce: boolean) {
      if (!video) return;
      if (reduce) {
        video.pause();
        return;
      }
      void Promise.resolve(video.play()).catch(() => undefined);
    }

    applyReducedMotion(media.matches);

    function onChange(event: MediaQueryListEvent) {
      applyReducedMotion(event.matches);
    }

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return (
    <video
      ref={videoRef}
      src={INTELLIGENCE_SIZZLE_VIDEO_URL}
      className="block w-full"
      autoPlay
      muted
      loop
      playsInline
      controls
      aria-label="CopilotKit Intelligence product demo"
    />
  );
}

export function IntelligenceOverview() {
  return (
    <div className="not-prose relative pb-2">
      <div className="flex flex-col pb-6">
        <div className="shell-docs-radius-surface relative w-full overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]">
          <SizzleVideo />
        </div>
        <div className="mt-5">
          <HeroStartActions
            prompt={
              <OnboardingPromptButton
                variant="hero"
                surface="docs_intelligence_hero"
                markdownUrl={`${OVERVIEW_PATH}.mdx`}
              />
            }
            quickstart={
              <QuickstartLinkButton
                href={CONNECT_HREF}
                fromPath={OVERVIEW_PATH}
                variant="secondary"
                label="Connect an app"
              />
            }
          />
        </div>
      </div>
    </div>
  );
}

export function IntelligenceFeatureCards() {
  return (
    <section
      aria-labelledby="intelligence-features-heading"
      className="not-prose"
    >
      <h2
        id="intelligence-features-heading"
        className="text-[1.5rem] font-semibold tracking-[-0.015em] text-[var(--text)] sm:text-[1.75rem]"
      >
        What you can add next
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <article
            key={feature.title}
            className="shell-docs-radius-surface border border-[var(--border)] bg-[var(--bg-surface)] px-5 pb-5 pt-3 shadow-[var(--shadow-panel)]"
          >
            <h3 className="m-0 flex items-center gap-2 text-lg font-semibold leading-none text-[var(--text)]">
              <feature.icon
                className="size-[1em] shrink-0 text-[var(--accent)]"
                aria-hidden="true"
              />
              <span>{feature.title}</span>
            </h3>
            <p className="mt-3 text-[15px] leading-[1.6] text-[var(--text-muted)]">
              {feature.body}
            </p>
            <Link
              href={feature.href}
              className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--accent)] no-underline hover:brightness-110"
            >
              {feature.cta}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
