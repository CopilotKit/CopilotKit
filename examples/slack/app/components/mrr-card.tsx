/**
 * `MrrCard` — a presentational MRR summary card written as plain host-tag JSX
 * (`<div>`/`<span>`), NOT the `@copilotkit/channels-ui` component vocabulary.
 * Under the channels JSX runtime, host tags compile to real React elements, so
 * `render_mrr` posts this straight to `thread.post` and the SDK routes it to the
 * Takumi image path automatically (no wrapper, no `createElement`).
 *
 * The return type is `ChannelNode` because that's what `JSX.Element` is under
 * this pragma; the runtime value is a React element, which `thread.post` detects
 * and rasterizes.
 */
import type { ChannelNode } from "@copilotkit/channels";

export interface MrrCardProps {
  value: string;
  delta: number;
}

/** A presentational card rendered to an image via Takumi (arbitrary app JSX). */
export function MrrCard({ value, delta }: MrrCardProps): ChannelNode {
  const up = delta >= 0;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: "100%",
        height: "100%",
        padding: 32,
        backgroundColor: "#0f172a",
        color: "#f8fafc",
        borderRadius: 16,
      }}
    >
      <span style={{ fontSize: 16, color: "#94a3b8" }}>
        Monthly recurring revenue
      </span>
      <span style={{ fontSize: 56, fontWeight: 700 }}>{value}</span>
      <span style={{ fontSize: 22, color: up ? "#22c55e" : "#ef4444" }}>
        {`${up ? "+" : "-"}${Math.abs(delta)}%`}
      </span>
    </div>
  );
}
