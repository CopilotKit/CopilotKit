// docs-map-parts.tsx — the presentational pieces of the homepage product map.
//
// These four components hold no data. All copy, destinations and icon choices
// live in `@/lib/homepage-map`; everything here is layout and treatment.
//
// The three block variants are the whole of the page's visual hierarchy:
//
//   choice → dashed, flat, near-transparent. "This is your pick, not our
//            product." Used by the Frontend and Agent blocks.
//   core   → solid border, elevated surface, panel shadow. The product.
//   plus   → flat accent border and accent-tinted fill. The added, hosted
//            layer.
//
// Nothing here animates. An earlier draft ran dots along the connectors; on a
// page whose job is orientation, permanent motion pulls the eye off the text.

import React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Brain,
  MessageSquare,
  MessageSquareMore,
  Paintbrush,
  Repeat,
  SearchCheck,
  Server,
  Settings,
  Sparkles,
  User,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type {
  LucideIconName,
  MapCapability,
  MapPick,
} from "@/lib/homepage-map";

// Named imports in an explicit record, never `import * as icons` with a
// dynamic index: a namespace object indexed at runtime forces the bundler to
// retain every lucide export, and Next's optimizePackageImports cannot
// rewrite it. Same idiom as FRAMEWORK_ICONS in ./icons/framework-icons.tsx.
const CAPABILITY_ICONS: Record<LucideIconName, LucideIcon> = {
  MessageSquare,
  Paintbrush,
  User,
  Settings,
  Repeat,
  Wrench,
  MessageSquareMore,
  Brain,
  Sparkles,
  SearchCheck,
  BarChart3,
  Server,
};

/**
 * Shared by the map's server-rendered Intelligence grid and its client-rendered
 * CopilotKit grid. It lives in this boundary-neutral module on purpose: a
 * `"use client"` module's named exports are replaced by client references in
 * the server layer, so exporting it from the client child would hand the
 * server a throwing function instead of a class string.
 */
export const MAP_TILE_GRID_CLASS =
  "grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3";

type BlockVariant = "choice" | "core" | "plus";

const BLOCK_VARIANT_CLASS: Record<BlockVariant, string> = {
  choice:
    "border border-dashed border-[var(--border)] bg-[var(--bg-elevated)]/10",
  core: "border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]",
  plus: "border border-[var(--accent)] bg-[var(--accent-dim)] shadow-[var(--shadow-panel)]",
};

export function MapBlock({
  variant,
  kicker,
  name,
  nameSize = "lg",
  description,
  action,
  badge,
  id,
  children,
}: {
  variant: BlockVariant;
  kicker: string;
  name: string;
  nameSize?: "lg" | "sm";
  description: string;
  action?: { label: string; href: string };
  badge?: string;
  id?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const isPlus = variant === "plus";

  return (
    <section
      id={id}
      className={`shell-docs-radius-surface not-prose p-5 sm:p-6 ${BLOCK_VARIANT_CLASS[variant]}`}
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start sm:gap-6">
        <div className="min-w-0">
          <p
            className={`text-[10px] font-bold uppercase tracking-[0.12em] ${
              isPlus ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
            }`}
          >
            {kicker}
          </p>
          <h2
            className={`mt-1 font-semibold tracking-[-0.02em] text-[var(--text)] ${
              nameSize === "lg" ? "text-xl sm:text-[1.375rem]" : "text-base"
            }`}
          >
            {name}
          </h2>
          <p className="mt-1.5 max-w-[64ch] text-sm leading-relaxed text-[var(--text-secondary)]">
            {description}
          </p>
          {badge ? (
            <span className="shell-docs-radius-control mt-3 inline-block border border-[var(--accent)] bg-[var(--accent-dim)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--accent)]">
              {badge}
            </span>
          ) : null}
        </div>
        {action ? (
          <Link
            href={action.href}
            className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-[var(--accent)] no-underline hover:brightness-110"
          >
            {action.label}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function MapConnector({
  variant,
  label,
}: {
  variant: "plain" | "accent";
  label?: string;
}): React.JSX.Element {
  const accent = variant === "accent";
  const rule = accent
    ? "w-px h-4 bg-[var(--accent)]"
    : "w-px h-4 bg-[var(--border)]";

  return (
    <div
      aria-hidden="true"
      className="flex flex-col items-center justify-center py-1"
    >
      <span className={rule} />
      {label ? (
        <span
          className={
            accent
              ? "shell-docs-radius-control my-1 border border-[var(--accent)] bg-[var(--accent-dim)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-[var(--accent)]"
              : "shell-docs-radius-control my-1 border border-dashed border-[var(--border)] px-2 py-0.5 font-mono text-[10px] tracking-[0.08em] text-[var(--text-muted)]"
          }
        >
          {label}
        </span>
      ) : null}
      <span className={rule} />
    </div>
  );
}

export function CapabilityTile({
  capability,
  href,
  tone,
}: {
  capability: MapCapability;
  /** Already scoped by the caller — this component does no path maths. */
  href: string;
  tone: "core" | "plus";
}): React.JSX.Element {
  const Icon = CAPABILITY_ICONS[capability.icon];

  const plus = tone === "plus";

  return (
    <Link
      href={href}
      className={`shell-docs-radius-surface group block border p-3.5 no-underline transition-colors ${
        plus
          ? "border-[var(--accent)]/40 bg-[var(--bg-surface)]/60 hover:border-[var(--accent)]"
          : "border-[var(--border)] bg-[var(--bg-elevated)]/30 hover:border-[var(--accent)]"
      }`}
    >
      <span
        className={`shell-docs-radius-icon flex h-7 w-7 items-center justify-center border ${
          plus
            ? "border-[var(--accent)]/40 bg-[var(--accent-dim)] text-[var(--accent)]"
            : "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--accent)]"
        }`}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden={true} />
      </span>
      <span className="mt-2.5 block text-sm font-semibold leading-snug text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">
        {capability.title}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-[var(--text-muted)]">
        {capability.body}
      </span>
    </Link>
  );
}

export function PickGrid({
  picks,
}: {
  picks: readonly MapPick[];
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))]">
      {picks.map((pick) => (
        <Link
          key={pick.id}
          href={pick.href}
          className="shell-docs-radius-control flex items-baseline gap-2 border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-2 no-underline transition-colors hover:border-[var(--accent)]"
        >
          <span className="truncate text-xs font-medium text-[var(--text-secondary)]">
            {pick.name}
          </span>
          {pick.note ? (
            <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
              {pick.note}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
