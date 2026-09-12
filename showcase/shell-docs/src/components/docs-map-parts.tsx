// docs-map-parts.tsx — the presentational pieces of the homepage setup
// wizard's intro and option grids.
//
// These components hold no data and no wizard state. All copy, options and
// icon choices live in `@/lib/homepage-map` or in the wizard component that
// drives them (`./setup-wizard`); the wizard also owns the "which step is
// current", "what is selected so far" bookkeeping and simply hands each of
// these components the slice it needs. Everything here is layout, treatment
// and DOM semantics.
//
// The wizard shows one step at a time: the card shell, its progress rail and
// its Back/Continue footer live in `./wizard-stepper-parts`, which reuses
// `CORE_TREATMENT_CLASS` exported below — solid border, elevated surface,
// panel shadow — rather than keeping a second copy of the same class string.
// There is no locked or done treatment here any more: a step the reader
// cannot yet reach is simply not rendered, so it has nothing left to
// express, unlike the earlier scrolling variant that kept every step on
// screen at once.
//
// The option grids are buttons, not links: there are no destinations left on
// this page, only choices that feed a prompt assembled in the last step.
// `PickGrid` is single-choice (frontend, agent backend) and expresses its
// selection purely through the accent border and fill — a radio-like control
// doesn't need to also announce itself with a checkmark. `CapabilityGrid` is
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

/** Looks up and draws a capability's icon. Exported (the lookup record
 *  itself is not) so the wizard's review step can render the same mark
 *  without keeping a second copy of `CAPABILITY_ICONS` — see the header
 *  comment above on why that record is a named-import map rather than a
 *  namespace import: a second copy would invite the same bundle-size
 *  regression this one exists to avoid. */
export function CapabilityIconMark({
  icon,
  className,
}: {
  icon: LucideIconName;
  className?: string;
}): React.JSX.Element {
  const Icon = CAPABILITY_ICONS[icon];
  return <Icon className={className ?? "h-3.5 w-3.5"} />;
}

/**
 * Shared by the wizard's feature grid. It lives in this boundary-neutral
 * module on purpose: a `"use client"` module's named exports are replaced by
 * client references in the server layer, so exporting it from a client
 * child would hand the server a throwing function instead of a class
 * string.
 */
export const MAP_TILE_GRID_CLASS =
  "grid content-start grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3";

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

/** Solid border, elevated surface, panel shadow — the one step treatment
 *  this variant needs. Exported so `WizardCard` in `./wizard-stepper-parts`
 *  applies the same class string instead of keeping a second copy. */
export const CORE_TREATMENT_CLASS =
  "border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]";

/** The heading and paragraph that frame the wizard. One step up from a
 *  step's own heading, so it reads as their parent rather than a fifth
 *  step.
 *
 *  Centred like every other section title on the homepage (the video
 *  heading, the backend grid heading) — this component stops at the
 *  frame. The wizard card itself, and the option tiles `PickGrid` and
 *  `CapabilityGrid` render inside it, are a different register (content
 *  read top to bottom, not a section banner) and stay left-aligned;
 *  resist the urge to carry `text-center` down into them too. */
export function MapIntro({
  heading,
  body,
}: {
  heading: string;
  body: string;
}): React.JSX.Element {
  return (
    <div
      className={`not-prose mb-7 flex flex-col items-center text-center md:mb-9 ${MAP_SLOT.full}`}
    >
      <h2 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--text)] sm:text-[1.625rem]">
        {heading}
      </h2>
      <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-[var(--text-secondary)]">
        {body}
      </p>
    </div>
  );
}

/** Draws whichever logo the pick's data asked for. The switch is the whole of
 *  this component's knowledge: which logo belongs to which pick is decided in
 *  `@/lib/homepage-map`. Exported so the wizard's review step can render the
 *  same mark instead of re-deciding frontend-vs-framework on its own — which
 *  logo belongs to which pick is one decision, not two implementations. The
 *  agent-backend logos carry `--accent` (blue-violet), matching the identical
 *  `FrameworkLogo` in `./framework-selector`'s own picker; `FrontendLogo` is a
 *  different component and is left at its own default treatment. */
export function PickLogoMark({
  logo,
  size = 14,
}: {
  logo: MapPickLogo;
  size?: number;
}): React.JSX.Element {
  if (logo.kind === "frontend") {
    return <FrontendLogo icon={logo.icon} size={size} className="shrink-0" />;
  }
  return (
    <FrameworkLogo
      slug={logo.slug}
      fallbackSrc={logo.fallbackSrc}
      size={size}
      className="shrink-0 text-[var(--accent)]"
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

/** `"compact"` is a single row per option — small logo, truncated name, no
 *  summary — used where density is the point (the nineteen agent backends).
 *  `"card"` is a larger tile — bigger logo, the name at `text-sm`, and the
 *  pick's `summary` beneath it — used where five options would otherwise
 *  leave most of the step's frame empty (the frontends). */
export type PickGridSize = "compact" | "card";

function pickGridClass(size: PickGridSize): string {
  return size === "card"
    ? "grid content-start grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
    : "grid content-start grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))]";
}

function pickButtonClass(size: PickGridSize, selected: boolean): string {
  const base =
    "shell-docs-radius-control cursor-pointer border text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  // "card" mirrors `CapabilityGrid`'s own button shell: a block box holding
  // a logo+name row, the summary below it — rather than the flex-col stack
  // the compact row still uses, which has nothing to stack a summary under.
  const layout =
    size === "card"
      ? "block w-full p-3.5"
      : "flex items-center gap-2 px-2.5 py-2";
  return `${base} ${layout} ${optionToneClass(selected)}`;
}

export function PickGrid({
  picks,
  selectedId,
  disabled,
  onSelect,
  size = "compact",
}: {
  picks: readonly MapPick[];
  selectedId?: string;
  disabled: boolean;
  onSelect: (id: string) => void;
  size?: PickGridSize;
}): React.JSX.Element {
  return (
    <div className={pickGridClass(size)}>
      {picks.map((pick) => {
        const selected = pick.id === selectedId;
        return (
          <button
            key={pick.id}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onSelect(pick.id)}
            className={pickButtonClass(size, selected)}
          >
            {size === "card" ? (
              <>
                <span className="flex min-w-0 items-center gap-2">
                  <PickLogoMark logo={pick.logo} size={22} />
                  <span className="truncate text-sm font-semibold text-[var(--text)]">
                    {pick.name}
                  </span>
                </span>
                {pick.summary ? (
                  <span className="mt-2.5 block text-xs leading-relaxed text-[var(--text-muted)]">
                    {pick.summary}
                  </span>
                ) : null}
              </>
            ) : (
              <>
                <PickLogoMark logo={pick.logo} />
                <span className="truncate text-xs font-medium text-[var(--text-secondary)]">
                  {pick.name}
                </span>
              </>
            )}
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
        const selected = selectedIds.includes(capability.id);
        return (
          <button
            key={capability.id}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onToggle(capability.id)}
            className={`shell-docs-radius-surface block w-full cursor-pointer border p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${optionToneClass(
              selected,
            )}`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="shell-docs-radius-icon flex h-7 w-7 shrink-0 items-center justify-center border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--accent)]"
                >
                  <CapabilityIconMark icon={capability.icon} />
                </span>
                <span className="truncate text-sm font-semibold leading-snug text-[var(--text)]">
                  {capability.title}
                </span>
              </span>
              {selected ? (
                <Check
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-[var(--accent)]"
                />
              ) : null}
            </span>
            <span className="mt-2.5 block text-xs leading-relaxed text-[var(--text-muted)]">
              {capability.body}
            </span>
          </button>
        );
      })}
    </div>
  );
}
