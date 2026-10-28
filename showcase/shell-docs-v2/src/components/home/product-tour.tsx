"use client";

import { useState, useSyncExternalStore } from "react";
import { Play } from "lucide-react";
import {
  DirectoryGlyph,
  LearningGlyph,
  ThreadsGlyph,
} from "@/components/icons/glyphs";
import { cn } from "@/lib/cn";

// Real 12-second product clips (see shell-docs/public/videos/product-tour/
// README.md); the full walkthroughs live on Loom.
const STOPS = [
  {
    id: "overview",
    label: "Overview",
    icon: DirectoryGlyph,
    title: "Build agent-powered apps",
    body: "Connect your agent to your app with interactive UI, shared state, and human approvals.",
    loom: "5a04db6a04584b79b98021737d012d53",
  },
  {
    id: "rich-threads",
    label: "Rich threads",
    icon: ThreadsGlyph,
    title: "Threads that keep their UI",
    body: "Conversations persist with their generative UI, so users pick up where they left off.",
    loom: "79817778d29e490c97225127d2f17b3a",
  },
  {
    id: "automatic-learning",
    label: "Automatic learning",
    icon: LearningGlyph,
    title: "Agents that learn from use",
    body: "With CopilotKit Intelligence, agents keep user memories and learn from real use.",
    loom: "2978fbfe42324e509057ac5fd46b7a70",
  },
] as const;

function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
}

export function ProductTour() {
  const [active, setActive] =
    useState<(typeof STOPS)[number]["id"]>("overview");
  const reduced = useReducedMotion();
  const stop = STOPS.find((s) => s.id === active) ?? STOPS[0];

  return (
    <section className="not-prose relative my-10 overflow-hidden rounded-3xl border bg-fd-card p-2 md:p-3">
      <div className="relative flex flex-col gap-2 md:gap-3">
        <div
          role="tablist"
          aria-label="Product tour"
          className="flex gap-1 overflow-x-auto rounded-2xl bg-fd-background p-1"
        >
          {STOPS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={active === s.id}
              aria-controls="product-tour-panel"
              onClick={() => setActive(s.id)}
              className={cn(
                "inline-flex h-10 flex-1 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:outline-none",
                active === s.id
                  ? "bg-fd-background text-fd-foreground shadow-sm"
                  : "text-fd-muted-foreground hover:text-fd-foreground",
              )}
            >
              <s.icon className="size-4" aria-hidden="true" />
              {s.label}
            </button>
          ))}
        </div>

        <div
          id="product-tour-panel"
          role="tabpanel"
          className="overflow-hidden rounded-2xl border bg-fd-background"
        >
          <video
            key={stop.id}
            className="aspect-video w-full"
            src={`/videos/product-tour/${stop.id}.mp4`}
            poster={`/images/product-tour/${stop.id}.jpg`}
            autoPlay={!reduced}
            muted
            loop
            playsInline
            controls={reduced}
            aria-label={`${stop.title}: product clip`}
          />
        </div>

        <div className="flex flex-col gap-3 px-2 pt-1 pb-2 md:flex-row md:items-end md:justify-between md:px-3">
          <div className="max-w-[34rem]">
            <p className="text-lg font-semibold tracking-[-0.01em]">
              {stop.title}
            </p>
            <p className="text-sm text-fd-muted-foreground">{stop.body}</p>
          </div>
          <a
            href={`https://www.loom.com/share/${stop.loom}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md text-sm font-medium text-fd-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:outline-none"
          >
            <Play className="size-3.5" aria-hidden="true" />
            Watch the full walkthrough
          </a>
        </div>
      </div>
    </section>
  );
}
