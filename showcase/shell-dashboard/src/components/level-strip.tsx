"use client";
/**
 * Per-integration L1-L4 strip: four badges showing Up / Wired / Chats / Tools.
 * Reads integration-scoped rows from the live-status map.
 */
import { ToneChip } from "@/components/badges";
import { keyFor, type LiveStatusMap, type BadgeTone } from "@/lib/live-status";
import type { Integration } from "@/lib/registry";

interface LevelBadge {
  name: string;
  tone: BadgeTone;
  title: string;
}

function resolveBadge(
  live: LiveStatusMap,
  dimension: string,
  slug: string,
  label: string,
): LevelBadge {
  const row = live.get(keyFor(dimension, slug)) ?? null;
  if (!row) {
    return { name: label, tone: "gray", title: `${label}: no data yet` };
  }
  const tone: BadgeTone =
    row.state === "green"
      ? "green"
      : row.state === "red"
        ? "red"
        : row.state === "degraded"
          ? "amber"
          : "gray";
  return {
    name: label,
    tone,
    title: `${label}: ${row.state} since ${row.observed_at}`,
  };
}

export function LevelStrip({
  integration,
  liveStatus,
}: {
  integration: Integration;
  liveStatus: LiveStatusMap;
}) {
  const slug = integration.slug;
  const up = resolveBadge(liveStatus, "health", slug, "Up");
  const wired = resolveBadge(liveStatus, "agent", slug, "Wired");
  const chats = resolveBadge(liveStatus, "chat", slug, "Chats");

  // Tools n/a gate: only show real state if integration has tool-rendering demo
  const hasToolRendering = integration.demos.some(
    (d) => d.id === "tool-rendering",
  );
  const tools: LevelBadge = hasToolRendering
    ? resolveBadge(liveStatus, "tools", slug, "Tools")
    : { name: "Tools", tone: "gray", title: "Tools: n/a (no tool-rendering demo)" };

  const badges = [up, wired, chats, tools];

  return (
    <div
      className="flex items-center gap-1"
      data-testid="level-strip"
      data-slug={slug}
    >
      {badges.map((b) => (
        <ToneChip
          key={b.name}
          tone={b.tone}
          label={b.name.charAt(0)}
          title={b.title}
        />
      ))}
    </div>
  );
}
