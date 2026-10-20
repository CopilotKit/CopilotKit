"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Play } from "lucide-react";
import { useHomepageTelemetry } from "@/lib/use-homepage-telemetry";

interface Props {
  title: string;
  loomId: string;
  poster: string;
  /** Short, silent local clip; the full recording still plays through Loom. */
  previewSrc: string;
}

const LOOM_ORIGIN = "https://www.loom.com";
/** Adapted from the silent, viewport-aware preview in Atai's docs prototype. */
export function DocsVideoPreview({ title, loomId, poster, previewSrc }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const [previewing, setPreviewing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [fullPlayback, setFullPlayback] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const track = useHomepageTelemetry();

  // Play a muted preview from the middle of the recording while it is on
  // screen, and pause it offscreen, in a hidden tab, or under reduced motion.
  // The full recording with sound starts only after an explicit click.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let inView = false;
    const update = () => {
      const play = inView && !document.hidden && !motion.matches;
      setPreviewing(play);
      if (play) setLoaded(true);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        update();
      },
      { threshold: 0.25 },
    );
    observer.observe(container);
    document.addEventListener("visibilitychange", update);
    motion.addEventListener("change", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      motion.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (previewing && !fullPlayback) {
      // Autoplay can be blocked; keep the poster and full-playback button usable.
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [loaded, previewing, fullPlayback]);

  // Loom hides its own fullscreen control at this player size, so full
  // playback gets a button that expands the player over the whole window and
  // also requests real fullscreen. Browsers and webviews that refuse or never
  // settle that request (iOS Safari, embedded app browsers) keep the
  // window-sized player. Leaving real fullscreen collapses the player too.
  useEffect(() => {
    const player = playerRef.current;
    if (!expanded || !player) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (document.fullscreenElement === player)
        document.exitFullscreen().catch(() => {});
    };
  }, [expanded]);

  return (
    <div
      ref={containerRef}
      className="relative aspect-video overflow-hidden bg-[var(--bg-elevated)] bg-cover bg-bottom"
      style={{
        backgroundImage: fullPlayback ? undefined : `url(${poster})`,
      }}
    >
      {fullPlayback ? (
        <div
          ref={playerRef}
          className={
            expanded ? "fixed inset-0 z-[100] bg-black" : "absolute inset-0"
          }
        >
          <iframe
            src={`${LOOM_ORIGIN}/embed/${loomId}?autoplay=1&t=0s&hide_owner=true&hide_title=true`}
            title={`${title}: full walkthrough`}
            className="h-full w-full"
            allow="autoplay; fullscreen"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
          <button
            type="button"
            aria-label={expanded ? "Exit full screen" : "Full screen"}
            title={expanded ? "Exit full screen" : "Full screen"}
            className="absolute left-3 top-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white shadow-lg transition-colors hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            onClick={() => {
              setExpanded(!expanded);
              // Safari only grants fullscreen inside the click handler itself.
              if (!expanded)
                playerRef.current?.requestFullscreen?.().catch(() => {});
            }}
          >
            {expanded ? (
              <Minimize2 aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Maximize2 aria-hidden="true" className="h-4 w-4" />
            )}
          </button>
        </div>
      ) : (
        <>
          {loaded && (
            <video
              ref={videoRef}
              src={previewSrc}
              poster={poster}
              muted
              loop
              playsInline
              preload="auto"
              aria-hidden="true"
              onPlaying={() => setRevealed(true)}
              className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${revealed ? "opacity-100" : "opacity-0"}`}
            />
          )}
          <button
            type="button"
            aria-label={`Watch full walkthrough: ${title}`}
            className="group absolute inset-0 flex cursor-pointer items-center justify-center bg-black/0 transition-colors hover:bg-black/10 focus-visible:outline-none"
            onClick={() => {
              setFullPlayback(true);
              track("video_play_clicked", {
                walkthrough: title,
                loom_id: loomId,
              });
            }}
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--accent-fill)_55%,white)] text-white shadow-md transition-[background-color,transform] group-hover:bg-[var(--accent-fill)] group-hover:scale-105 group-focus-visible:ring-2 group-focus-visible:ring-[var(--accent)] group-focus-visible:ring-offset-2">
              <Play aria-hidden="true" className="ml-1 h-7 w-7 fill-current" />
            </span>
          </button>
        </>
      )}
    </div>
  );
}
