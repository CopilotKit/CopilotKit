// docs-map-parts.tsx — the presentational pieces of the homepage setup
// wizard.
//
// These components hold no data and no wizard state. All copy, options and
// icon choices live in `@/lib/homepage-map` or in the wizard component that
// drives this module (`./setup-wizard`); the wizard also owns the "which step
// is reached", "what is selected so far" bookkeeping and simply hands each of
// these components the slice it needs. Everything here is layout, treatment
// and DOM semantics.
//
// The wizard has four steps: pick a frontend, pick zero or more features,
// pick an agent backend, copy a prompt carrying all three answers. A step is
// always in exactly one of three states (`StepState`):
//
//   locked → dashed border, near-transparent fill, at reduced opacity. "You
//            cannot act here yet." Every option inside is disabled — not
//            just dimmed, since a disabled step's options must not take a
//            click and must not be reachable by Tab. A step that looked
//            locked but still answered a click would let someone answer
//            step 3 before step 1.
//   active → solid border, elevated surface, panel shadow, plus an accent
//            ring. "Act here." The one step whose options are live.
//   done    → the same dashed-border, near-transparent treatment as locked,
//            but at full opacity. "You already answered this, and you can
//            still see and change it" — a completed step stays open rather
//            than collapsing, so the page shows the path taken instead of
//            hiding it.
//
// The option grids are buttons, not links: there are no destinations left on
// this page, only choices that feed a prompt assembled in step 4. `PickGrid`
// is single-choice (frontend, agent backend) and expresses its selection
// purely through the accent border and fill — a radio-like control doesn't
// need to also announce itself with a checkmark. `CapabilityGrid` is
// multi-choice (features) and does render a checkmark on each selected
// option, because a toggle needs to show its own state independently of the
// accent treatment. Both grids express selection through `aria-pressed`
// (deliberately the same attribute for single- and multiple-choice, so
// there is one thing to assert instead of two) and never through an
// `aria-label` that would shadow the option's own visible text.
//
// `CapabilityGrid` also carries each capability's one-line `body` beneath its
// title — the six feature names are bare phrases ("Shared state", "Frontend
// tools") that nobody could choose between without their explanation, and an
// earlier draft that hid the body from assistive technology to keep the
// accessible name equal to the title only made things worse: adjacent labels
// ran together for screen-reader users. So the body stays visible and
// un-hidden, and the button's accessible name is simply its full text content
// — title followed by body — same as any ordinary toggle button carrying a
// heading and a description. `PickGrid` has no second line, so its
// accessible name is exactly `pick.name`.
//
// Layout is a single vertical stack — `StepConnector` between steps, lit
// with `--accent` once the step below it has been reached, `--text-muted`
// otherwise (the `--border` token is near-invisible against this page's
// ground, which is why the connector reaches for the muted text token
// instead). There is no side-by-side arrangement any more: CopilotKit
// Intelligence does not appear on this page, so there is no side branch for
// a layout to carve out room for.

import React from "react";
import {
  Check,
  MessageSquare,
  Paintbrush,
  Repeat,
  Settings,
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

export type StepState = "locked" | "active" | "done";

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
};

/**
 * Shared by the wizard's feature grid. It lives in this boundary-neutral
 * module on purpose: a `"use client"` module's named exports are replaced by
 * client references in the server layer, so exporting it from a client
 * child would hand the server a throwing function instead of a class
 * string.
 */
export const MAP_TILE_GRID_CLASS =
  "grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3";

/** The grid the whole wizard lives in — a single full-width column on every
 *  step, four columns wide on `md` so `MAP_SLOT.full` below has something to
 *  span. */
export const MAP_GRID_CLASS = "grid grid-cols-1 md:grid-cols-4";

/** Every step and the intro spans the whole width. There used to be a
 *  second slot (`inset`) for a side branch that no longer exists on this
 *  page — see this file's header comment. */
const MAP_SLOT = {
  full: "md:col-start-1 md:col-span-4",
} as const;

/** The two treatments a step can be built from — `active` layers an accent
 *  ring on top of `core`; `done` and `locked` differ only in opacity. */
const STEP_TREATMENT_CLASS = {
  core: "border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]",
  choice:
    "border border-dashed border-[var(--border)] bg-[var(--bg-elevated)]/10",
} as const;

const STEP_STATE_CLASS: Record<StepState, string> = {
  active: `${STEP_TREATMENT_CLASS.core} ring-1 ring-[var(--accent)]`,
  done: `${STEP_TREATMENT_CLASS.choice} opacity-100`,
  locked: `${STEP_TREATMENT_CLASS.choice} opacity-40`,
};

/** The heading and paragraph that frame the wizard. One step up from a
 *  step's own heading, so it reads as their parent rather than a fifth
 *  step. */
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

/** The plain rule between two stacked steps. Lit with `--accent` once the
 *  step below has been reached, `--text-muted` otherwise — see this file's
 *  header comment for why `--text-muted` and not `--border`. */
export function StepConnector({ lit }: { lit: boolean }): React.JSX.Element {
  return (
    <div aria-hidden="true" className={`flex justify-center ${MAP_SLOT.full}`}>
      <span
        className={`h-10 w-px md:h-14 ${
          lit ? "bg-[var(--accent)]" : "bg-[var(--text-muted)]"
        }`}
      />
    </div>
  );
}

export function StepBlock({
  state,
  step,
  name,
  description,
  hint,
  id,
  children,
}: {
  state: StepState;
  /** 1-based. Rendered as the kicker, e.g. "STEP 1". */
  step: number;
  name: string;
  description: string;
  /**
   * The right-hand hint. Locked: the prerequisite ("Choose your frontend
   * first"). Done: the chosen value. Active: usually absent.
   */
  hint?: string;
  id?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      id={id}
      className={`shell-docs-radius-surface not-prose p-5 sm:p-6 ${MAP_SLOT.full} ${STEP_STATE_CLASS[state]}`}
    >
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-baseline sm:gap-6">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {`STEP ${step}`}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-[var(--text)] sm:text-[1.375rem]">
            {name}
          </h2>
        </div>
        {hint ? (
          <p className="shrink-0 text-xs text-[var(--text-muted)]">{hint}</p>
        ) : null}
      </div>
      <p className="mt-1.5 max-w-[64ch] text-sm leading-relaxed text-[var(--text-secondary)]">
        {description}
      </p>
      <div className="mt-4">{children}</div>
    </section>
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
      className="shrink-0 text-[var(--text-secondary)]"
    />
  );
}

/** Shared border/fill treatment for an option button in either grid — the
 *  accent ring-and-fill when selected doubles as the only selection signal
 *  `PickGrid` gives, since it renders no checkmark. */
function optionToneClass(selected: boolean): string {
  return selected
    ? "border-[var(--accent)] bg-[var(--accent-dim)]"
    : "border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)]";
}

export function PickGrid({
  picks,
  selectedId,
  disabled,
  onSelect,
}: {
  picks: readonly MapPick[];
  selectedId?: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))]">
      {picks.map((pick) => {
        const selected = pick.id === selectedId;
        return (
          <button
            key={pick.id}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onSelect(pick.id)}
            className={`shell-docs-radius-control flex items-center gap-2 border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${optionToneClass(
              selected,
            )}`}
          >
            <PickLogo logo={pick.logo} />
            <span className="truncate text-xs font-medium text-[var(--text-secondary)]">
              {pick.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function CapabilityGrid({
  capabilities,
  selectedIds,
  disabled,
  onToggle,
}: {
  capabilities: readonly MapCapability[];
  selectedIds: readonly string[];
  disabled: boolean;
  onToggle: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className={MAP_TILE_GRID_CLASS}>
      {capabilities.map((capability) => {
        const Icon = CAPABILITY_ICONS[capability.icon];
        const selected = selectedIds.includes(capability.id);
        return (
          <button
            key={capability.id}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onToggle(capability.id)}
            className={`shell-docs-radius-surface block w-full border p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${optionToneClass(
              selected,
            )}`}
          >
            <span className="flex items-center justify-between gap-2">
              <span
                aria-hidden="true"
                className="shell-docs-radius-icon flex h-7 w-7 items-center justify-center border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--accent)]"
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              {selected ? (
                <Check
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-[var(--accent)]"
                />
              ) : null}
            </span>
            <span className="mt-2.5 block text-sm font-semibold leading-snug text-[var(--text)]">
              {capability.title}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-[var(--text-muted)]">
              {capability.body}
            </span>
          </button>
        );
      })}
    </div>
  );
}
