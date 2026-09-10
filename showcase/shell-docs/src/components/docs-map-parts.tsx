// docs-map-parts.tsx — the presentational pieces of the homepage product map.
//
// These components hold no data. All copy, destinations and icon choices
// live in `@/lib/homepage-map` or in the composer `./docs-product-map`;
// everything here is layout and treatment.
//
// The three block variants are the whole of the page's visual hierarchy:
//
//   choice → dashed border, near-transparent fill, no shadow. "This is your
//            pick, not our product." Used by the Frontend and Agent blocks.
//   core   → solid border, elevated surface, panel shadow. The product.
//   plus   → solid accent border and accent-tinted fill, carrying the same
//            panel shadow as core. The added, hosted layer.
//
// Layout: the wide arrangement is one four-column grid (25% per column),
// because a plain vertical stack claims something untrue — that the agent
// talks to Intelligence. It does not: the agent connects to the runtime over
// AG-UI, and Intelligence hangs off that runtime as a side branch. So
// Frontend, CopilotKit and Agent take all four columns, Intelligence takes
// the right three (`inset`), the `+ adds` branch drops straight down from
// CopilotKit into Intelligence's middle, and the AG-UI axis runs down
// column 1 from CopilotKit's bottom edge, past Intelligence, to the Agent
// block. The branch shares Intelligence's three columns, so centring it is
// what lands it on that block's middle — no offsets to keep in step.
//
// Rows, in document order:
//   1 intro   2 Frontend   3 rule   4 CopilotKit
//   5 + adds branch (inset)   6 Intelligence (inset)   7 gap (inset)
//   8 Agent
// Only `MapAxis` is placed explicitly (column 1, rows 5-7): it is the one
// item that spans rows, and auto-placement would drop it into rows 6-8.
// Everything else auto-flows from document order.
//
// Below the `md` breakpoint the whole map collapses to a single column and
// the elbow and the axis degrade to ordinary vertical connectors. There is
// deliberately no second arrangement for narrow screens — the intro
// paragraph states the relationship in words, and that is what carries it
// there.
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

import { FrontendLogo } from "./frontend-logo";
import { FrameworkLogo } from "./icons/framework-icons";
import type {
  LucideIconName,
  MapCapability,
  MapPick,
  MapPickLogo,
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

/** The grid the whole map lives in. See this file's header for the row map. */
export const MAP_GRID_CLASS = "grid grid-cols-1 md:grid-cols-4";

/**
 * Column placement in that grid. Percentages are expressed as column spans
 * rather than widths so nothing depends on a measured pixel value: `inset`
 * is three of four columns — 75%, right-aligned, because it starts at
 * column 2.
 */
const MAP_SLOT = {
  full: "md:col-start-1 md:col-span-4",
  inset: "md:col-start-2 md:col-span-3",
} as const;

type BlockVariant = "choice" | "core" | "plus";

const BLOCK_VARIANT_CLASS: Record<BlockVariant, string> = {
  choice:
    "border border-dashed border-[var(--border)] bg-[var(--bg-elevated)]/10",
  core: "border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]",
  plus: "border border-[var(--accent)] bg-[var(--accent-dim)] shadow-[var(--shadow-panel)]",
};

/** The heading and paragraph that frame the map. One step up from a block's
 *  own heading, so it reads as their parent rather than a fifth block. */
export function MapIntro({
  heading,
  body,
}: {
  heading: string;
  body: string;
}): React.JSX.Element {
  return (
    <div className={`not-prose mb-7 md:mb-9 ${MAP_SLOT.full}`}>
      <h2 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--text)] sm:text-[1.625rem]">
        {heading}
      </h2>
      <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-[var(--text-secondary)]">
        {body}
      </p>
    </div>
  );
}

export function MapBlock({
  variant,
  kicker,
  name,
  nameSize = "lg",
  icon,
  description,
  action,
  placement = "full",
  id,
  children,
}: {
  variant: BlockVariant;
  kicker: string;
  name: string;
  nameSize?: "lg" | "sm";
  /** Rendered beside the name, never inside the heading — a heading's text
   *  is what a screen reader and the docs' own tooling read. */
  icon?: React.ReactNode;
  description: string;
  action?: { label: string; href: string };
  placement?: keyof typeof MAP_SLOT;
  id?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const isPlus = variant === "plus";

  return (
    <section
      id={id}
      className={`shell-docs-radius-surface not-prose p-5 sm:p-6 ${MAP_SLOT[placement]} ${BLOCK_VARIANT_CLASS[variant]}`}
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
          <div className="mt-1 flex items-center gap-2">
            {icon ? (
              <span
                aria-hidden="true"
                className="shrink-0 text-xl leading-none text-[var(--accent)]"
              >
                {icon}
              </span>
            ) : null}
            <h2
              className={`font-semibold tracking-[-0.02em] text-[var(--text)] ${
                nameSize === "lg" ? "text-xl sm:text-[1.375rem]" : "text-base"
              }`}
            >
              {name}
            </h2>
          </div>
          <p className="mt-1.5 max-w-[64ch] text-sm leading-relaxed text-[var(--text-secondary)]">
            {description}
          </p>
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

/** Shared by the branch and the axis: a pill needs enough weight to be read
 *  as a label on a line rather than a stray word. */
const PILL_BASE =
  "shell-docs-radius-control shrink-0 border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.05em]";

/**
 * Every connector takes the border colour of the blocks it joins, so a line
 * reads as the same material as the boxes at its ends: the grey `--border`
 * between the three neutral blocks, `--accent` on the branch into
 * Intelligence, whose own border is accent. That makes the neutral lines
 * deliberately quiet — the layout, not the line weight, is what carries the
 * relationship here.
 */
const CONNECTOR_COLOR_CLASS = "bg-[var(--border)]";

/** The plain rule between two stacked full-width blocks. */
export function MapConnector(): React.JSX.Element {
  return (
    <div aria-hidden="true" className={`flex justify-center ${MAP_SLOT.full}`}>
      <span className={`h-10 w-px md:h-14 ${CONNECTOR_COLOR_CLASS}`} />
    </div>
  );
}

/**
 * The `+ adds` branch from CopilotKit straight down into Intelligence's top
 * edge. It sits in the same three columns Intelligence does, so centring it
 * puts the line on that block's horizontal middle without a single measured
 * offset — the line stays centred when the map changes width or Intelligence
 * grows taller.
 */
export function MapBranch({ label }: { label: string }): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={`flex flex-col items-center ${MAP_SLOT.inset}`}
    >
      <MapBranchRule />
      <span
        className={`${PILL_BASE} my-1.5 border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]`}
      >
        {label}
      </span>
      <MapBranchRule />
    </div>
  );
}

/** One of the two runs the branch's pill sits between. */
function MapBranchRule(): React.JSX.Element {
  return <span className="h-6 w-px bg-[var(--accent)] md:h-7" />;
}

/**
 * The AG-UI axis: the agent's connection to the runtime, not to Intelligence.
 * In the wide layout it occupies column 1 across the elbow row, the
 * Intelligence row and the gap row, so it visibly starts at CopilotKit's
 * bottom edge, passes Intelligence, and ends at the Agent block.
 *
 * The pill is a link, so the container cannot be `aria-hidden` — a link
 * hidden from assistive technology is a link that does not exist. The two
 * rules carry it individually instead.
 */
export function MapAxis({
  label,
  href,
}: {
  label: string;
  href: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center md:col-start-1 md:row-start-5 md:row-span-3">
      <MapAxisRule />
      {/* Larger than the branch's pill: this one is a link, so it is also a
          hit target, and it names the protocol the whole axis stands for. */}
      <Link
        href={href}
        className={`${PILL_BASE} my-1.5 border-dashed border-[var(--text-muted)] px-3.5 py-1.5 font-mono text-[12px] text-[var(--text-secondary)] no-underline hover:border-[var(--accent)] hover:text-[var(--accent)]`}
      >
        {label}
      </Link>
      <MapAxisRule />
    </div>
  );
}

function MapAxisRule(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`min-h-6 w-px flex-1 ${CONNECTOR_COLOR_CLASS}`}
    />
  );
}

/**
 * The gap between Intelligence and the Agent block, in the wide layout only.
 * `MapAxis` spans this row; without an item to give the row a height it
 * would collapse and the axis would stop at Intelligence's bottom edge —
 * saying "Intelligence feeds the agent", the exact error this layout exists
 * to fix. Stacked, the axis is an ordinary connector and spaces itself, so
 * this renders nothing.
 */
export function MapGap(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={`hidden md:block md:h-20 ${MAP_SLOT.inset}`}
    />
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

/** Draws whichever logo the pick's data asked for. The switch is the whole of
 *  this component's knowledge: which logo belongs to which pick is decided in
 *  `@/lib/homepage-map`. */
function PickLogo({ logo }: { logo: MapPickLogo }): React.JSX.Element {
  if (logo.kind === "frontend") {
    return <FrontendLogo icon={logo.icon} size={14} className="shrink-0" />;
  }
  return (
    <FrameworkLogo
      slug={logo.slug}
      fallbackSrc={logo.fallbackSrc}
      size={14}
      // Accent, matching the same logos in the sidebar's framework picker.
      // A reader meets a framework's mark in both places, so it should not
      // change colour between them.
      className="shrink-0 text-[var(--accent)]"
    />
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
          className="shell-docs-radius-control flex items-center gap-2 border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-2 no-underline transition-colors hover:border-[var(--accent)]"
        >
          <PickLogo logo={pick.logo} />
          <span className="truncate text-xs font-medium text-[var(--text-secondary)]">
            {pick.name}
          </span>
          {pick.note ? (
            <span className="ml-auto shrink-0 text-[10px] text-[var(--text-muted)]">
              {pick.note}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
