"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Play } from "lucide-react";
import { useHomepageTelemetry } from "@/lib/use-homepage-telemetry";

interface Props {
  title: string;
  loomId: string;
  poster: string;
  previewSrc: string;
}

/** Adapted from the silent, viewport-aware preview in Atai's docs prototype. */
export function DocsVideoPreview({ title, loomId, poster, previewSrc }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const autoStarted = useRef(false);
  const [visible, setVisible] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [finished, setFinished] = useState(false);
  const [fullPlayback, setFullPlayback] = useState(false);
  const track = useHomepageTelemetry();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const observer = new IntersectionObserver(
      ([entry]) => {
        const inView = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        setVisible(inView);
        if (inView && !motion.matches && !autoStarted.current) {
          autoStarted.current = true;
          setPreviewing(true);
        }
        if (!inView) setPreviewing(false);
      },
      { threshold: 0.25 },
    );
    const pause = () => {
      if (document.hidden || motion.matches) setPreviewing(false);
    };
    observer.observe(container);
    document.addEventListener("visibilitychange", pause);
    motion.addEventListener("change", pause);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", pause);
      motion.removeEventListener("change", pause);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (previewing) void video.play().catch(() => setPreviewing(false));
    else video.pause();
  }, [previewing]);

  // Loom supplies short MP4 preview clips. Loop them briefly, then stop;
  // the full recording is loaded only after an explicit click.
  useEffect(() => {
    if (!previewing) return;
    const timer = window.setTimeout(() => {
      setPreviewing(false);
      setFinished(true);
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [previewing]);

  return (
    <div
      ref={containerRef}
      className="overflow-hidden rounded-xl border border-[var(--nav-control-border)] bg-[var(--bg-surface)]"
    >
      <div className="relative aspect-video overflow-hidden bg-[var(--bg-elevated)]">
        {fullPlayback ? (
          <iframe
            src={`https://www.loom.com/embed/${loomId}?autoplay=1`}
            title={`${title}: full walkthrough`}
            className="h-full w-full"
            allow="autoplay; fullscreen"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        ) : (
          <video
            ref={videoRef}
            src={visible ? previewSrc : undefined}
            poster={poster}
            muted
            playsInline
            preload="none"
            aria-label={`${title}: silent preview`}
            className="h-full w-full object-contain"
            loop
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--nav-control-border)] px-4 py-3">
        {fullPlayback ? (
          <a
            href={`https://www.loom.com/share/${loomId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center gap-2 text-sm font-medium text-[var(--accent)] hover:underline"
          >
            Open on Loom <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
          </a>
        ) : (
          <>
            <button
              type="button"
              className="min-h-9 text-sm text-[var(--text-secondary)] hover:text-[var(--text)]"
              onClick={() => {
                autoStarted.current = true;
                if (!previewing && videoRef.current)
                  videoRef.current.currentTime = 0;
                setPreviewing(!previewing);
                setFinished(true);
              }}
            >
              {previewing
                ? "Pause preview"
                : finished
                  ? "Replay preview"
                  : "Play preview"}
            </button>
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-[var(--accent)] hover:underline"
              onClick={() => {
                setPreviewing(false);
                setFullPlayback(true);
                track("video_play_clicked", {
                  walkthrough: title,
                  loom_id: loomId,
                });
              }}
            >
              <Play aria-hidden="true" className="h-4 w-4" />
              Watch full walkthrough
            </button>
          </>
        )}
      </div>
    </div>
  );
}
