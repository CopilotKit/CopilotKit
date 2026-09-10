// wizard-review.tsx — the homepage setup wizard's step 4 review grid: three
// tiles, one per answer (frontend, agent backend, features), each a full
// navigation control back to the step that answer came from.
//
// Boundary-neutral (no "use client"), same as `./docs-map-parts`, so it can
// be rendered and tested on its own. This component holds no wizard state:
// the three answers and the `onNavigate` callback are handed in by
// `./setup-wizard`, which is the only place that knows "which step is
// current" or "what has been picked so far" — see that file's header
// comment. `onNavigate` is the same callback the progress rail uses
// (`handleJump` in `setup-wizard.tsx`), so a tile click animates as an
// ordinary backward step rather than a special-cased jump.
//
// Built to read as the same visual language as the option tiles in
// `PickGrid`/`CapabilityGrid` (`./docs-map-parts`) — a bordered surface that
// turns accent on hover — but this is never `PickGrid` itself: these tiles
// are never selected and never carry `aria-pressed`, since they are
// navigation, not a choice. The whole tile is the click target, and the
// whole tile's accessible name comes from `aria-label` ("Change frontend",
// "Change agent backend", "Change features"): three tiles that all read
// "Change" in a screen reader's element list would be indistinguishable, so
// each carries its own name even though the visible word at the bottom of
// every tile is the same, which is what keeps the label-in-name rule intact
// (each label contains that visible word).
//
// The frontend and agent-backend marks come from `PickLogoMark`, and each
// feature's own icon from `CapabilityIconMark` — both imported from
// `./docs-map-parts`, never reimplemented here. `CapabilityIconMark` wraps a
// deliberate named-import icon record rather than a namespace import (605 KB
// minified against 6 KB for named imports — see that file's header comment
// on `CAPABILITY_ICONS`); a second copy of that record here would invite the
// same bundle-size regression straight back.

import React from "react";

import { CapabilityIconMark, PickLogoMark } from "@/components/docs-map-parts";
import type { MapCapability, MapPick } from "@/lib/homepage-map";

/** Shared tile shell: bordered surface, accent border on hover — the same
 *  hover treatment as an option tile, without the selected-state fill,
 *  since a review tile is never selected. `aria-label` is the tile's entire
 *  accessible name (see the header comment above); the visible "Change" at
 *  the bottom is there for sighted readers, not for the name. */
const TILE_CLASS =
  "shell-docs-radius-control flex h-full cursor-pointer flex-col items-stretch gap-1.5 border border-[var(--border)] bg-[var(--bg-surface)] p-3.5 text-left transition-colors hover:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none";

const KICKER_CLASS =
  "text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]";

const NONE_VALUE = (
  <span className="text-sm text-[var(--text-muted)]">None</span>
);

/** One tile: an uppercase kicker, the answer's own content in the middle,
 *  and the quiet "Change" affordance pinned to the bottom via the middle
 *  section's `flex-1`. Module-level rather than a closure inside
 *  `WizardReview`: it captures nothing from that component's scope. */
function ReviewTile({
  kicker,
  changeLabel,
  onChange,
  children,
}: {
  kicker: string;
  changeLabel: string;
  onChange: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-label={changeLabel}
      className={TILE_CLASS}
    >
      <span className={KICKER_CLASS}>{kicker}</span>
      <span className="flex flex-1 flex-col justify-center gap-1.5">
        {children}
      </span>
      <span className="text-xs font-semibold text-[var(--text-muted)]">
        Change
      </span>
    </button>
  );
}

/** The frontend and agent-backend tiles' middle content: the mark beside the
 *  value, the same title-row shape as an option tile's own title row in
 *  `PickGrid`. */
function PickValue({
  name,
  logo,
}: {
  name: string;
  logo: MapPick["logo"];
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-2">
      <PickLogoMark logo={logo} size={20} />
      <span className="truncate text-sm font-semibold text-[var(--text)]">
        {name}
      </span>
    </span>
  );
}

export interface WizardReviewProps {
  /** `null` only in the unreachable case of arriving at step 4 without a
   *  frontend picked yet — `SetupWizard` never actually lands here without
   *  one (see `landingStep` there), but the type stays honest rather than
   *  asserting non-null for a case this component cannot itself rule out. */
  readonly frontend: Pick<MapPick, "name" | "logo"> | null;
  readonly backend: Pick<MapPick, "name" | "logo"> | null;
  /** The selected features, already filtered to the reader's choices and in
   *  display order — this component does not know about `featureIds`, only
   *  the resulting list. Empty renders a muted "None"; the tile still
   *  navigates to step 3. */
  readonly features: readonly Pick<MapCapability, "id" | "title" | "icon">[];
  /** The same callback `WizardProgress`'s rail uses (`handleJump` in
   *  `setup-wizard.tsx`): 1 for frontend, 2 for agent backend, 3 for
   *  features. Which tile maps to which step number is fixed layout, not
   *  wizard state, so it is hard-coded here — but how navigation itself
   *  works is entirely the caller's concern. */
  readonly onNavigate: (step: number) => void;
}

/** Step 4's review grid: three tiles, one per answer, replacing the old
 *  `<dl>` list — see this file's header comment for why each is a full
 *  navigation button rather than a row with a small trailing control. */
export function WizardReview({
  frontend,
  backend,
  features,
  onNavigate,
}: WizardReviewProps): React.JSX.Element {
  return (
    <div className="grid flex-1 grid-cols-1 gap-2.5 sm:grid-cols-3">
      <ReviewTile
        kicker="Frontend"
        changeLabel="Change frontend"
        onChange={() => onNavigate(1)}
      >
        {frontend ? (
          <PickValue name={frontend.name} logo={frontend.logo} />
        ) : (
          NONE_VALUE
        )}
      </ReviewTile>
      <ReviewTile
        kicker="Agent backend"
        changeLabel="Change agent backend"
        onChange={() => onNavigate(2)}
      >
        {backend ? (
          <PickValue name={backend.name} logo={backend.logo} />
        ) : (
          NONE_VALUE
        )}
      </ReviewTile>
      <ReviewTile
        kicker="Features"
        changeLabel="Change features"
        onChange={() => onNavigate(3)}
      >
        {features.length > 0 ? (
          <span className="flex flex-col gap-1.5">
            {features.map((feature) => (
              <span key={feature.id} className="flex items-center gap-2">
                <CapabilityIconMark
                  icon={feature.icon}
                  className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]"
                />
                <span className="truncate text-sm font-medium text-[var(--text)]">
                  {feature.title}
                </span>
              </span>
            ))}
          </span>
        ) : (
          NONE_VALUE
        )}
      </ReviewTile>
    </div>
  );
}
