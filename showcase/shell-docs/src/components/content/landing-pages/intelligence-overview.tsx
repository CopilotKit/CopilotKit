"use client";

import { Card, Cards } from "@/components/mdx-components";
import {
  BarChart3,
  Brain,
  Hash,
  Lightbulb,
  MessagesSquare,
  SearchCheck,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { INTELLIGENCE_FEATURES } from "@/lib/intelligence-features";

import { HeroOnboardingPromptButton } from "@/components/hero-onboarding-prompt-button";
import {
  HeroStartActions,
  QuickstartLinkButton,
} from "@/components/hero-start-commands";

export const INTELLIGENCE_SIZZLE_VIDEO_URL =
  "https://github.com/user-attachments/assets/72b7b4f3-b6e7-460c-a932-5746fe3c8db3";

const CONNECT_HREF = "/intelligence/quickstart";

const FEATURE_ICONS = {
  threads: MessagesSquare,
  memories: Brain,
  learning: Lightbulb,
  analytics: BarChart3,
  channels: Hash,
  inspector: SearchCheck,
} as const;

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
              <HeroOnboardingPromptButton surface="docs_intelligence_hero" />
            }
            quickstart={
              <QuickstartLinkButton
                href={CONNECT_HREF}
                fromPath="/intelligence/overview"
                variant="secondary"
                label="Quickstart"
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
    <section aria-labelledby="intelligence-features-heading">
      <h2 id="intelligence-features-heading">What Intelligence gives you</h2>
      <p>
        Each capability is a page of its own, and every one works with the agent
        and frontend you already run. Open the one you want to add first.
      </p>
      {/* Cards are links; keep them out of the prose link styling. */}
      <div className="not-prose intelligence-accent-cards">
        <Cards>
          {INTELLIGENCE_FEATURES.map((feature) => {
            const Icon = FEATURE_ICONS[feature.icon];
            return (
              <Card
                key={feature.title}
                href={feature.href}
                title={feature.title}
                description={feature.body}
                icon={<Icon aria-hidden="true" />}
              />
            );
          })}
        </Cards>
      </div>
    </section>
  );
}
