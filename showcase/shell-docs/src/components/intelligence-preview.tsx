"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { INTELLIGENCE_SIZZLE_VIDEO_URL } from "./content/landing-pages/intelligence-overview";

/** A short, silent preview; full walkthroughs remain an explicit action. */
export function IntelligencePreview({ children }: { children?: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canResume = useRef(true);
  const userInitiated = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const sync = () => {
      if (
        visible &&
        !document.hidden &&
        canResume.current &&
        (!motion.matches || userInitiated.current)
      ) {
        void video.play().catch(() => setPlaying(false));
      } else video.pause();
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              const latest = entries.at(-1);
              if (latest)
                visible =
                  latest.isIntersecting && latest.intersectionRatio >= 0.25;
              sync();
            },
            { threshold: 0.25 },
          );
    observer?.observe(video);
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer?.disconnect();
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      video.pause();
    };
  }, []);

  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden bg-[var(--bg-elevated)]">
        <video
          ref={videoRef}
          src={INTELLIGENCE_SIZZLE_VIDEO_URL}
          muted
          playsInline
          preload="metadata"
          poster="https://cdn.loom.com/sessions/thumbnails/79817778d29e490c97225127d2f17b3a-250a43d55abed071.jpg"
          aria-label="Eight-second silent Intelligence preview"
          className="h-full w-full object-contain"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={() => {
            const video = videoRef.current;
            if (video && video.currentTime >= 8) {
              canResume.current = false;
              video.pause();
              setFinished(true);
            }
          }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <button
          type="button"
          className="rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-semibold text-[var(--text)]"
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            if (playing) {
              canResume.current = false;
              video.pause();
            } else {
              if (finished) video.currentTime = 0;
              canResume.current = true;
              userInitiated.current = true;
              setFinished(false);
              void video.play().catch(() => setPlaying(false));
            }
          }}
        >
          {playing
            ? "Pause preview"
            : finished
              ? "Replay 8-second preview"
              : "Play 8-second preview"}
        </button>
        {children}
      </div>
    </div>
  );
}
