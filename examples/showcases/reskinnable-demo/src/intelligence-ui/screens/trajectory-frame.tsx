"use client";

/**
 * Trajectory detail inside the Intelligence shell. The content is Atai's
 * trajectory view, unchanged, embedded from /intelligence/trajectory-view/[id]
 * (an iframe keeps its stylesheet from colliding with the shell's). The frame
 * grows to the page's height so the shell surface does the scrolling.
 */
import { useEffect, useRef, useState } from "react";
import {
  IntelligenceShell,
  INTELLIGENCE_BASE,
} from "../shell/intelligence-shell";

export function TrajectoryFrame(props: {
  readonly trajectoryId: string;
  readonly focusEventId: string | null;
}) {
  const [height, setHeight] = useState(900);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        type?: string;
        height?: number;
        top?: number;
      } | null;
      if (
        data?.type === "intelligence-trajectory-height" &&
        typeof data.height === "number"
      )
        setHeight(data.height);
      if (
        data?.type === "intelligence-trajectory-scroll" &&
        typeof data.top === "number" &&
        frame.current
      ) {
        const surface =
          frame.current.closest(".shell-content-surface") ??
          document.scrollingElement;
        const offset =
          frame.current.getBoundingClientRect().top +
          data.top -
          window.innerHeight / 3;
        surface?.scrollBy({ top: offset, behavior: "smooth" });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const query = new URLSearchParams({ embed: "1" });
  if (props.focusEventId) query.set("event", props.focusEventId);
  return (
    <IntelligenceShell
      section={{
        label: "Trajectories",
        to: `${INTELLIGENCE_BASE}/trajectories`,
      }}
      detail={props.trajectoryId}
    >
      <iframe
        ref={frame}
        title={`Trajectory ${props.trajectoryId}`}
        src={`${INTELLIGENCE_BASE}/trajectory-view/${encodeURIComponent(props.trajectoryId)}?${query.toString()}`}
        style={{
          display: "block",
          width: "100%",
          height,
          border: 0,
          background: "transparent",
        }}
      />
    </IntelligenceShell>
  );
}
