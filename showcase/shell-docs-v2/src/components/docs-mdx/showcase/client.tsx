"use client";

// The client pieces of the showcase components: links that report where the
// reader went, the Intelligence product video, and the framework landing's
// demo explorer. Everything they show is computed on the server and passed
// in as plain props.

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { DemoFrame } from "@/components/demo-frame";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { trackEvent, type AnalyticsProperties } from "@/lib/telemetry/analytics";

/** A link that sends a PostHog event (shell-docs' names) when followed. */
export function TrackedLink({
  href,
  event,
  properties,
  className,
  target,
  children,
}: {
  href: string;
  event: string;
  properties: AnalyticsProperties;
  className?: string;
  target?: "_blank";
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      target={target}
      rel={target ? "noreferrer noopener" : undefined}
      onClick={() => trackEvent(event, properties)}
    >
      {children}
    </Link>
  );
}

/** Autoplays muted, and stays paused for readers who prefer reduced motion. */
export function ProductVideo({ src, label }: { src: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = (reduce: boolean) => {
      if (reduce) video.pause();
      else void Promise.resolve(video.play()).catch(() => undefined);
    };
    apply(media.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return (
    <video
      ref={ref}
      src={src}
      className="block w-full"
      autoPlay
      muted
      loop
      playsInline
      controls
      aria-label={label}
    />
  );
}

export interface ExplorerFeature {
  id: string;
  title: string;
  description: string;
  /** The live demo (or recorded walkthrough) to frame. */
  src: string;
  /** The demo's page in the showcase, for live demos. */
  href?: string;
  /** The demo's source on GitHub. */
  sourceHref?: string;
}

/**
 * The framework landing's feature explorer: one chip per feature and the
 * chosen one running in a demo frame, with its showcase page a click away.
 */
export function FeatureExplorer({
  features,
  frameworkName,
  analytics,
}: {
  features: ExplorerFeature[];
  frameworkName: string;
  /** `docs.journey_continued` dimensions: frontend, backend, from_path. */
  analytics: AnalyticsProperties;
}) {
  const [selected, setSelected] = useState(features[0]?.id);
  const active = features.find((f) => f.id === selected) ?? features[0];
  if (!active) return null;
  return (
    <section
      aria-label={`${frameworkName} features and demos`}
      className="flex flex-col gap-4"
    >
      <ToggleGroup
        aria-label="Choose a feature"
        value={[active.id]}
        onValueChange={(v) => {
          if (v[0]) setSelected(v[0]);
        }}
        variant="outline"
        spacing={1.5}
        // Above the frame that follows, so the chips' grown hit area wins.
        className="relative z-10 flex-wrap"
      >
        {features.map((f) => (
          <ToggleGroupItem
            key={f.id}
            value={f.id}
            // The ::after strip grows the touch target to 44px tall.
            className="relative h-8 rounded-full bg-card px-3 text-sm font-medium text-muted-foreground after:absolute after:inset-x-0 after:-inset-y-2 hover:bg-accent hover:text-foreground aria-pressed:border-brand-lilac-mid aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-brand-lilac-mid dark:aria-pressed:border-brand-lilac dark:aria-pressed:ring-brand-lilac"
          >
            {f.title}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <DemoFrame
        key={active.id}
        src={active.src}
        title={
          active.href
            ? `${frameworkName}: ${active.title} live demo`
            : `${active.title} product walkthrough`
        }
        label={active.title}
        sourceHref={active.sourceHref}
      >
        {active.description}
        {active.href ? (
          <>
            {" "}
            <TrackedLink
              href={active.href}
              target="_blank"
              event="docs.journey_continued"
              properties={{
                ...analytics,
                destination_type: "demo",
                destination_path: active.href,
              }}
              className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-4 hover:underline"
            >
              Open in the showcase
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </TrackedLink>
          </>
        ) : null}
      </DemoFrame>
    </section>
  );
}
