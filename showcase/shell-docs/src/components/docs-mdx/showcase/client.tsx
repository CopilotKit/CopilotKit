"use client";

// The client pieces of the showcase components: links that report where the
// reader went, and the Intelligence product video. Everything they show is
// computed on the server and passed in as plain props.

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { trackEvent } from "@/lib/telemetry/analytics";
import type { AnalyticsProperties } from "@/lib/telemetry/analytics";

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
