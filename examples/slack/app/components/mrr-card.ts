/**
 * `MrrCard` — a presentational MRR summary card. Authored with plain
 * `createElement` (NOT the `@copilotkit/channels-ui` JSX vocabulary): it's
 * arbitrary app JSX, so `render_mrr` posts it directly and the SDK routes it
 * to the Takumi image path automatically (no wrapper needed).
 */
import { createElement as h } from "react";
import type { ReactElement } from "react";

export interface MrrCardProps {
  value: string;
  delta: number;
}

/** A presentational card rendered to an image via Takumi (arbitrary app JSX). */
export function MrrCard({ value, delta }: MrrCardProps): ReactElement {
  const up = delta >= 0;
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: "100%",
        height: "100%",
        padding: 32,
        backgroundColor: "#0f172a",
        color: "#f8fafc",
        borderRadius: 16,
      },
    },
    h(
      "span",
      { style: { fontSize: 16, color: "#94a3b8" } },
      "Monthly recurring revenue",
    ),
    h("span", { style: { fontSize: 56, fontWeight: 700 } }, value),
    h(
      "span",
      { style: { fontSize: 22, color: up ? "#22c55e" : "#ef4444" } },
      `${up ? "▲" : "▼"} ${Math.abs(delta)}%`,
    ),
  );
}
