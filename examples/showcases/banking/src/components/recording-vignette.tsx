"use client";

import { useRecording } from "@/components/recording-context";

/**
 * A soft pulsating violet glow that hugs the canvas edges while the agent is
 * recording a demonstrated officer action — the visible signal that "the agent
 * is watching and recording this for future reference."
 *
 * Purely presentational + non-blocking: a fixed full-viewport overlay with
 * `pointer-events: none`, driven by the `data-recording` attribute. All styling
 * (edge glow, pulse keyframes, reduced-motion fallback) lives in
 * `globals.css` under `.recording-vignette`.
 */
export function RecordingVignette() {
  const { isRecording } = useRecording();
  return (
    <div
      aria-hidden
      data-recording={isRecording ? "true" : "false"}
      className="recording-vignette"
    />
  );
}

export default RecordingVignette;
