"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { useHomepageTelemetry } from "@/lib/use-homepage-telemetry";

interface Props {
  title: string;
  loomId: string;
  poster: string;
  /** Seconds into the recording where the silent preview starts. */
  previewStart: number;
  /** Width / height of the recording. */
  aspectRatio: number;
}

const LOOM_ORIGIN = "https://www.loom.com";
// Loom always shows its control bar on a muted embed, pinned to the bottom of
// the player, and letterboxes the video in the middle. The preview player is
// sized so the video spans the frame's full width with its bottom edge on the
// frame's bottom edge: the bar falls below the frame, and recordings taller
// than 16:9 lose a strip off the top (the browser chrome in screen captures).
const CONTROL_BAR_PX = 72;
const PREVIEW_PARAMS =
  "autoplay=1&muted=1&hideEmbedTopBar=true&hide_owner=true&hide_share=true&hide_title=true&hide_speed=true";

/** Sends a player.js (https://github.com/embedly/player.js) command to Loom. */
function sendPlayerCommand(
  iframe: HTMLIFrameElement | null,
  command: Record<string, unknown>,
) {
  iframe?.contentWindow?.postMessage(
    JSON.stringify({ context: "player.js", version: "0.0.11", ...command }),
    LOOM_ORIGIN,
  );
}

/** Adapted from the silent, viewport-aware preview in Atai's docs prototype. */
export function DocsVideoPreview({
  title,
  loomId,
  poster,
  previewStart,
  aspectRatio,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewing, setPreviewing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [fullPlayback, setFullPlayback] = useState(false);
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

  // Loom starts every embed at 0:00 and fades in before seeking to `t`, so the
  // player stays transparent over the poster until it reaches the preview
  // start. At the end of the recording, the preview loops back to its start.
  useEffect(() => {
    if (!loaded) return;
    const onMessage = (event: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe || event.source !== iframe.contentWindow) return;
      let message;
      try {
        message =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (message?.context !== "player.js") return;
      if (message.event === "ready") {
        for (const name of ["timeupdate", "ended"])
          sendPlayerCommand(iframe, {
            method: "addEventListener",
            value: name,
            listener: name,
          });
        setReady(true);
      } else if (
        message.event === "timeupdate" &&
        message.value?.seconds >= previewStart
      ) {
        setRevealed(true);
      } else if (message.event === "ended") {
        sendPlayerCommand(iframe, {
          method: "setCurrentTime",
          value: previewStart,
        });
        sendPlayerCommand(iframe, { method: "play" });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loaded, previewStart]);

  useEffect(() => {
    if (ready)
      sendPlayerCommand(iframeRef.current, {
        method: previewing ? "play" : "pause",
      });
  }, [ready, previewing]);

  return (
    <div
      ref={containerRef}
      className="@container relative aspect-video overflow-hidden bg-[var(--bg-elevated)] bg-cover bg-bottom"
      style={{
        backgroundImage: fullPlayback ? undefined : `url(${poster})`,
      }}
    >
      {fullPlayback ? (
        <iframe
          src={`${LOOM_ORIGIN}/embed/${loomId}?autoplay=1`}
          title={`${title}: full walkthrough`}
          className="h-full w-full"
          allow="autoplay; fullscreen"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        />
      ) : (
        <>
          {loaded && (
            <iframe
              ref={iframeRef}
              src={`${LOOM_ORIGIN}/embed/${loomId}?${PREVIEW_PARAMS}&t=${previewStart}s`}
              title={`${title}: silent preview`}
              aria-hidden="true"
              tabIndex={-1}
              className={`pointer-events-none absolute inset-x-0 w-full transition-opacity duration-300 ${revealed ? "opacity-100" : "opacity-0"}`}
              style={{
                bottom: -CONTROL_BAR_PX,
                height: `calc(100cqw / ${aspectRatio} + ${2 * CONTROL_BAR_PX}px)`,
              }}
              allow="autoplay"
              sandbox="allow-scripts allow-same-origin"
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
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent-fill)] text-white shadow-lg transition-transform group-hover:scale-105 group-focus-visible:ring-2 group-focus-visible:ring-[var(--accent)] group-focus-visible:ring-offset-2">
              <Play aria-hidden="true" className="ml-1 h-7 w-7 fill-current" />
            </span>
          </button>
        </>
      )}
    </div>
  );
}
