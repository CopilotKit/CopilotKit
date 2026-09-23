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

import { HeroOnboardingPromptButton } from "@/components/hero-onboarding-prompt-button";
import {
  HeroStartActions,
  QuickstartLinkButton,
} from "@/components/hero-start-commands";

export const INTELLIGENCE_SIZZLE_VIDEO_URL =
  "https://github.com/user-attachments/assets/72b7b4f3-b6e7-460c-a932-5746fe3c8db3";

const CONNECT_HREF = "/intelligence/quickstart";

const FEATURES = [
  {
    title: "Rich Threads",
    body: "Save the conversation and open it again on another device.",
    href: "/threads",
    icon: MessagesSquare,
  },
  {
    title: "User Memories",
    body: "Keep facts about a person after the conversation ends.",
    href: "/intelligence/memories",
    icon: Brain,
  },
  {
    title: "Automatic Learning",
    body: "Turn real usage into skills you can review and publish.",
    href: "/learning",
    icon: Lightbulb,
  },
  {
    title: "Product Analytics",
    body: "See what people do with your agent.",
    href: "/intelligence/analytics",
    icon: BarChart3,
  },
  {
    title: "Channels",
    body: "Run the same agent in Slack or Microsoft Teams.",
    href: "/intelligence/channels",
    icon: Hash,
  },
  {
    title: "Inspector",
    body: "Watch threads, learning, and tool calls from your app on localhost.",
    href: "/inspector",
    icon: SearchCheck,
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
          {FEATURES.map((feature) => (
            <Card
              key={feature.title}
              href={feature.href}
              title={feature.title}
              description={feature.body}
              icon={<feature.icon aria-hidden="true" />}
            />
          ))}
        </Cards>
      </div>
    </section>
  );
}
