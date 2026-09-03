"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef } from "react";

import { HeroOnboardingPromptButton } from "@/components/hero-onboarding-prompt-button";
import {
  HeroStartActions,
  QuickstartLinkButton,
} from "@/components/hero-start-commands";

export const INTELLIGENCE_SIZZLE_VIDEO_URL =
  "https://github.com/user-attachments/assets/72b7b4f3-b6e7-460c-a932-5746fe3c8db3";

const CONNECT_HREF = "/intelligence/connect-your-runtime";
const PRICING_HREF = "https://www.copilotkit.ai/pricing";

const FEATURES = [
  {
    title: "Rich Threads",
    body: "Keep messages, generative UI, and tool activity across reloads and devices.",
    href: "/threads",
    cta: "Open the Rich Threads guide",
  },
  {
    title: "Analytics",
    body: "See what your agents do and where users get value, from the same interaction data.",
    href: "https://www.copilotkit.ai/copilotkit-intelligence#analytics-insights",
    cta: "See Analytics on the product page",
  },
  {
    title: "Automatic Learning",
    body: "Agents improve from real usage. No fine-tuning pipeline required.",
    href: "https://www.copilotkit.ai/copilotkit-intelligence#self-improvement",
    cta: "See Automatic Learning on the product page",
  },
  {
    title: "Self-hosting",
    body: "Run the same platform in your own cluster, VPC, or data boundary.",
    href: "/intelligence/self-hosting",
    cta: "Open the self-hosting guide",
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
      void video.play();
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
    <div className="relative pb-8">
      <header className="grid items-center gap-8 pb-12 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-5">
          <h1 className="max-w-[20ch] text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.02em] text-balance text-[var(--text)] sm:text-[2.25rem] md:text-[2.5rem]">
            Ship durable agent experiences
          </h1>
          <p className="mt-4 max-w-[58ch] text-base leading-[1.55] text-pretty text-[var(--text-muted)] sm:text-lg">
            CopilotKit Intelligence adds persistent threads, hosted inspection,
            and production operations next to the runtime you already run.
          </p>
          <div className="mt-7">
            <HeroStartActions
              prompt={
                <HeroOnboardingPromptButton surface="docs_intelligence_hero" />
              }
              quickstart={
                <QuickstartLinkButton
                  href={CONNECT_HREF}
                  fromPath="/intelligence/overview"
                  variant="secondary"
                  label="Connect an app"
                />
              }
            />
          </div>
        </div>
        <div className="lg:col-span-7">
          <div className="shell-docs-radius-surface relative overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]">
            <SizzleVideo />
          </div>
        </div>
      </header>

      <section aria-labelledby="intelligence-features-heading">
        <h2
          id="intelligence-features-heading"
          className="text-[1.5rem] font-semibold tracking-[-0.015em] text-[var(--text)] sm:text-[1.75rem]"
        >
          What you can add next
        </h2>
        <ul
          className="mt-6 grid list-none gap-4 p-0 sm:grid-cols-2"
          role="list"
        >
          {FEATURES.map((feature) => (
            <li
              key={feature.title}
              className="shell-docs-radius-surface border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-panel)]"
            >
              <h3 className="text-lg font-semibold text-[var(--text)]">
                {feature.title}
              </h3>
              <p className="mt-2 text-[15px] leading-[1.6] text-[var(--text-muted)]">
                {feature.body}
              </p>
              <Link
                href={feature.href}
                className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--accent)] no-underline hover:brightness-110"
              >
                {feature.cta}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-10 text-base text-[var(--text-muted)]">
        Plans start on the free Developer tier.{" "}
        <Link
          href={PRICING_HREF}
          className="font-medium text-[var(--accent)] no-underline hover:brightness-110"
        >
          See CopilotKit Intelligence pricing
        </Link>
        .
      </p>
    </div>
  );
}
