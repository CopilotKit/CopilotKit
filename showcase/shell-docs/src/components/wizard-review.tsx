// wizard-review.tsx — the homepage setup wizard's final review panel: one
// row per answer (whether the reader already has a project, frontend,
// agent backend, features), stacked inside a single bordered panel with
// hairline separators between them, each row a full navigation control back
// to the step that answer came from.
//
// Boundary-neutral (no "use client"), same as `./docs-map-parts`, so it can
// be rendered and tested on its own. This component holds no wizard state:
// the four answers and the `onNavigate` callback are handed in by
// `./setup-wizard`, which is the only place that knows "which step is
// current" or "what has been picked so far" — see that file's header
// comment. `onNavigate` is the same callback the progress rail uses
// (`handleJump` in `setup-wizard.tsx`), so a row click animates as an
// ordinary backward step rather than a special-cased jump.
//
// Rows over tiles: tiles side by side, each stretched to fill the card, used
// to read as another set of choices rather than as a confirmation of what
// was chosen — every tile held one short value in a lot of air. A single
// row per answer, led by the same numbered circle the reader already knows
// from the progress rail above the card, reads instead as "here is your
// answer to each step". A full-width row also means the feature list — up
// to six selected values — fits on one line rather than forcing the tile
// that held it to grow taller than the others or wrap its values into a
// stretched box.
//
// These rows are never `PickGrid` itself, despite reusing its hover
// treatment: they are never selected and never carry `aria-pressed`, since
// they are navigation, not a choice. The whole row is the click target, and
// the whole row's accessible name comes from `aria-label` ("Change project",
// "Change frontend", "Change agent backend", "Change features"): rows that
// all read "Change" in a screen reader's element list would be
// indistinguishable, so each carries its own name even though the visible
// word at the end of every row is the same, which is what keeps the
// label-in-name rule intact (each label contains that visible word).
//
// `onNavigate` carries a `pointerActivated` flag — `event.detail > 0` on the
// row's own click, computed here rather than handed the raw event — the
// same shape `WizardNav`/`WizardProgress` already report through their own
// `on*` callbacks (see that file's header comment). `setup-wizard.tsx` uses
// it to decide whether the step this row jumps to shows its heading's focus
// ring; without it every row click reported as a keyboard activation
// regardless of how the reader actually triggered it.
//
// The frontend and agent-backend marks come from `PickLogoMark`, each
// feature's own icon from `CapabilityIconMark` — both imported from
// `./docs-map-parts` — and the project row's checkmark/cross from
// `PROJECT_ANSWER_ICONS` in `./wizard-stepper-parts`, none of them
// reimplemented here. `CapabilityIconMark` wraps a deliberate named-import
// icon record rather than a namespace import (605 KB minified against 6 KB
// for named imports — see that file's header comment on `CAPABILITY_ICONS`);
// a second copy of any of these records here would invite the same
// bundle-size regression straight back.

import React from "react";

import { CapabilityIconMark, PickLogoMark } from "@/components/docs-map-parts";
import { PROJECT_ANSWER_ICONS } from "@/components/wizard-stepper-parts";
import type { MapCapability, MapPick } from "@/lib/homepage-map";

/** The panel wrapping every row: one hairline border around the whole
 *  group, `divide-y` for the separators between rows, and `overflow-hidden`
 *  so a row's hover fill never spills past the panel's own rounded
 *  corners. Deliberately carries no `flex-1` — see `WizardReview`'s own
 *  comment below for why that matters. */
const PANEL_CLASS =
  "shell-docs-radius-surface divide-y divide-[var(--border)] overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)]";

/** One row: the same hover treatment an option tile uses (accent fill, no
 *  border change needed since the panel's own border already frames the
 *  group), full width so the row itself is the click target end to end. */
const ROW_CLASS =
  "flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--accent-dim)] focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none";

/** The step number leading every row — the accent treatment, round rather
 *  than the shared control radius: the same circle-on-accent look
 *  `WizardProgress` gives the *current* step in the rail above the card
 *  (see `wizard-stepper-parts.tsx`), so the two read as the same numbers
 *  rather than a fresh numbering scheme invented here. */
const STEP_NUMBER_CLASS =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--accent)] bg-[var(--accent-dim)] text-[11px] font-bold text-[var(--accent)]";

/** The label column — the same small uppercase muted kicker treatment the
 *  card itself uses for "Step N of 4" (`WizardCard` in
 *  `wizard-stepper-parts.tsx`), given a fixed width so the values that
 *  follow line up from row to row. */
const ROW_LABEL_CLASS =
  "w-28 shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]";

const NONE_VALUE = (
  <span className="text-sm text-[var(--text-muted)]">None</span>
);

/** One row: step number, label, the answer's own content, and the quiet
 *  "Change" affordance pinned to the row's trailing edge. Module-level
 *  rather than a closure inside `WizardReview`: it captures nothing from
 *  that component's scope. */
function ReviewRow({
  step,
  kicker,
  changeLabel,
  onChange,
  children,
}: {
  step: number;
  kicker: string;
  changeLabel: string;
  /** `pointerActivated` is `event.detail > 0` on this row's own click — see
   *  the header comment above. */
  onChange: (pointerActivated: boolean) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={(event) => onChange(event.detail > 0)}
      aria-label={changeLabel}
      className={ROW_CLASS}
    >
      <span className={STEP_NUMBER_CLASS}>{step}</span>
      <span className={ROW_LABEL_CLASS}>{kicker}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
        {children}
      </span>
      <span className="shrink-0 text-xs font-semibold text-[var(--text-muted)]">
        Change
      </span>
    </button>
  );
}

/** The frontend and agent-backend rows' value content: the mark beside the
 *  name, in the colours it had on the step where it was chosen. */
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
      <span className="text-sm font-semibold text-[var(--text)]">{name}</span>
    </span>
  );
}

/** The project row's value content: the same checkmark/cross the step itself
 *  shows (`PROJECT_ANSWER_ICONS` in `wizard-stepper-parts.tsx`) beside the
 *  answer, the same icon-beside-value shape `PickValue` above gives its
 *  logo. The wording differs from the step on purpose: "Existing"/"New"
 *  reads as a fact about the project once the reader is looking back at a
 *  review of their answers, where the step's own "Yes"/"No" answers the
 *  question being asked in the moment. */
function ProjectValue({
  project,
}: {
  project: "yes" | "no";
}): React.JSX.Element {
  const Icon = PROJECT_ANSWER_ICONS[project];
  return (
    <span className="flex items-center gap-2">
      <Icon
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-[var(--accent)]"
      />
      <span className="text-sm font-semibold text-[var(--text)]">
        {project === "yes" ? "Existing" : "New"}
      </span>
    </span>
  );
}

export interface WizardReviewProps {
  /** `null` only in the unreachable case of arriving at the review step
   *  without having answered the project question yet — `SetupWizard` never
   *  actually lands here without an answer (see `landingStep` there), but
   *  the type stays honest rather than asserting non-null for a case this
   *  component cannot itself rule out. */
  readonly project: "yes" | "no" | null;
  /** `null` only in the same unreachable sense as `project` above, for the
   *  frontend pick. */
  readonly frontend: Pick<MapPick, "name" | "logo"> | null;
  readonly backend: Pick<MapPick, "name" | "logo"> | null;
  /** The selected features, already filtered to the reader's choices and in
   *  display order — this component does not know about `featureIds`, only
   *  the resulting list. Empty renders a muted "None"; the row still
   *  navigates to the features step. */
  readonly features: readonly Pick<MapCapability, "id" | "title" | "icon">[];
  /** The same callback `WizardProgress`'s rail uses (`handleJump` in
   *  `setup-wizard.tsx`): 1 for the project question, 2 for frontend, 3 for
   *  agent backend, 4 for features, plus the `pointerActivated` flag every
   *  other navigation path already reports (see the header comment above).
   *  Which row maps to which step number is fixed layout, not wizard state,
   *  so it is hard-coded here — but how navigation itself works is entirely
   *  the caller's concern. */
  readonly onNavigate: (step: number, pointerActivated: boolean) => void;
}

/** The review step's panel: one row per answer, replacing the old
 *  three-tile grid — see this file's header comment for why. Carries no
 *  `flex-1`: the card's content area (`WizardCard` in
 *  `wizard-stepper-parts.tsx`) is `flex flex-1 flex-col justify-center`, so
 *  a panel with no `flex-1` of its own is centred in the leftover room
 *  automatically, the same as every other step's options. The old grid
 *  opted into `flex-1` to fill the card top to bottom; a row panel has no
 *  reason to grow that tall, so it must not carry that class here. */
export function WizardReview({
  project,
  frontend,
  backend,
  features,
  onNavigate,
}: WizardReviewProps): React.JSX.Element {
  return (
    <div className={PANEL_CLASS}>
      <ReviewRow
        step={1}
        kicker="Project"
        changeLabel="Change project"
        onChange={(pointerActivated) => onNavigate(1, pointerActivated)}
      >
        {project ? <ProjectValue project={project} /> : NONE_VALUE}
      </ReviewRow>
      <ReviewRow
        step={2}
        kicker="Frontend"
        changeLabel="Change frontend"
        onChange={(pointerActivated) => onNavigate(2, pointerActivated)}
      >
        {frontend ? (
          <PickValue name={frontend.name} logo={frontend.logo} />
        ) : (
          NONE_VALUE
        )}
      </ReviewRow>
      <ReviewRow
        step={3}
        kicker="Agent backend"
        changeLabel="Change agent backend"
        onChange={(pointerActivated) => onNavigate(3, pointerActivated)}
      >
        {backend ? (
          <PickValue name={backend.name} logo={backend.logo} />
        ) : (
          NONE_VALUE
        )}
      </ReviewRow>
      <ReviewRow
        step={4}
        kicker="Features"
        changeLabel="Change features"
        onChange={(pointerActivated) => onNavigate(4, pointerActivated)}
      >
        {features.length > 0
          ? features.map((feature) => (
              <span key={feature.id} className="flex items-center gap-1.5">
                <CapabilityIconMark
                  icon={feature.icon}
                  className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]"
                />
                <span className="text-sm font-medium text-[var(--text)]">
                  {feature.title}
                </span>
              </span>
            ))
          : NONE_VALUE}
      </ReviewRow>
    </div>
  );
}
