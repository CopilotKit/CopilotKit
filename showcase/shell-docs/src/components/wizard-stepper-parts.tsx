// Presentational chrome for guided setup: progress, active question, choices,
// and navigation. State and transitions belong to SetupWizard.

import React from "react";
import { Folder, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** The mark for each of step 1's two answers ("Do you already have a
 *  project?") — shared by the step itself (`setup-wizard.tsx`'s
 *  `PROJECT_OPTIONS`, rendered through `ChoiceGrid` below) and the review's
 *  project row (`wizard-review.tsx`), so the two surfaces can never drift
 *  onto different icons for the same answer. Lives here rather than in
 *  `setup-wizard.tsx`, which is `"use client"`: a client module's named
 *  exports are replaced by throwing client references in the server layer,
 *  so a server-rendered consumer of this record would get a function that
 *  throws instead of the record itself.
 *
 *  A folder represents an existing project; a plus represents a new one.
 *
 *  Named imports in an explicit record, never `import * as icons` with a
 *  runtime index — see `docs-map-parts.tsx`'s `CAPABILITY_ICONS` comment for
 *  the bundle-size regression that guards against (605 KB minified for a
 *  namespace import indexed at runtime, vs. 6 KB for named imports). */
export const PROJECT_ANSWER_ICONS: Record<"yes" | "no", LucideIcon> = {
  yes: Folder,
  no: Plus,
};

export type StepperStep = {
  readonly n: number; // 1-based
  readonly label: string; // short, for the progress rail
};

// No `disabled:` variants — Continue is never rendered with the `disabled`
// attribute (see the header comment above), so styling for that state would
// be dead weight.
//
// Exported so the review step's copy button (`setup-wizard.tsx`) renders
// the same control instead of keeping a second copy of this string — it
// left the footer, but it is still the wizard's one accent action.
export const ACCENT_BUTTON_CLASS =
  "shell-docs-radius-control inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 border border-[var(--accent-fill)] bg-[var(--accent-fill)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none sm:w-auto";

// Exported so step 5's "Set up manually" action (`setup-wizard.tsx`, handed
// in through `WizardNav`'s `secondaryAction` slot) renders with the same
// quiet treatment Back already uses, rather than a second copy of this
// string living next to a routing concern this component doesn't have.
export const QUIET_BUTTON_CLASS =
  "shell-docs-radius-control inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 border border-transparent px-4 text-sm font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none sm:w-auto";

// The primary button's label changes shape across the wizard — Skip vs.
// Continue on the earlier steps, then Copy prompt / Copied / Copy blocked
// once it doubles as the review step's copy button — and without a floor
// the button itself resized on every swap, which read as a layout hiccup
// rather than a label change. The floor is sized for "Copy blocked", the
// longest label this button ever shows (12 characters, one longer than
// "Copy prompt"): roughly its text at text-sm font-semibold, plus the icon
// and icon-label gap the review step's copy button adds, plus the button's
// own horizontal padding, with a little slack rather than a value that only
// just fits.
//
// Exported for the same reason as `ACCENT_BUTTON_CLASS` above — the review
// step's copy button keeps this floor even though it is no longer rendered
// by this component.
export const PRIMARY_BUTTON_MIN_WIDTH_CLASS = "min-w-[9.5rem]";

/** The heading's own focus ring — applied through `:focus`, never
 *  `:focus-visible`, so its visibility is driven entirely by `WizardCard`'s
 *  `showFocusRing` prop rather than by a browser's own pointer/keyboard
 *  heuristic (unreliable for a ring following a programmatic `.focus()`
 *  call, which is how the heading is always focused — see that component's
 *  doc comment). `outline-none` on the heading itself, applied
 *  unconditionally, removes the browser's own default focus outline so this
 *  ring is the only one that can ever show. */
const HEADING_FOCUS_RING_CLASS =
  "focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--bg-surface)]";

/** The rail above the card: one button per step, a number plus a short
 *  label, connected by thin rules so it reads as one rail rather than four
 *  chips. */
export function WizardProgress({
  steps,
  current,
  furthest,
  onJump,
}: {
  steps: readonly StepperStep[];
  current: number;
  furthest: number;
  /** `pointerActivated` is `event.detail > 0` — see the header comment
   *  above. Computed here, next to the click, so the caller only ever
   *  receives a boolean. */
  onJump: (n: number, pointerActivated: boolean) => void;
}): React.JSX.Element {
  return (
    <ol className="mb-2 flex items-start gap-1 sm:gap-2">
      {steps.map((step, index) => {
        const isCurrent = step.n === current;
        const reached = step.n <= furthest;
        return (
          <React.Fragment key={step.n}>
            {index > 0 ? (
              <li
                aria-hidden="true"
                className={`mt-3.5 h-px w-2 shrink-0 sm:flex-1 ${
                  reached ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                }`}
              />
            ) : null}
            <li className="min-w-0 flex-1">
              <button
                type="button"
                disabled={!reached}
                aria-current={isCurrent ? "step" : undefined}
                onClick={(event) => onJump(step.n, event.detail > 0)}
                className={`flex min-h-11 w-full cursor-pointer flex-col items-center gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed ${
                  isCurrent
                    ? "text-[var(--accent)]"
                    : reached
                      ? "text-[var(--text-secondary)]"
                      : "text-[var(--text-muted)]"
                }`}
              >
                <span
                  className={`shell-docs-radius-control flex h-7 w-7 shrink-0 items-center justify-center border text-xs font-semibold ${
                    isCurrent
                      ? "border-[var(--accent-fill)] bg-[var(--accent-fill)] text-[var(--primary-foreground)]"
                      : reached
                        ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                        : "border-[var(--text-muted)] bg-[var(--bg-surface)]"
                  }`}
                >
                  {step.n}
                </span>
                <span className="whitespace-nowrap text-[10px] sm:text-xs">
                  {step.label}
                </span>
              </button>
            </li>
          </React.Fragment>
        );
      })}
    </ol>
  );
}

/** One active step. A shared minimum height fits the desktop choices; narrow layouts grow naturally. */
export function WizardCard({
  progress,
  name,
  description,
  headingRef,
  children,
  footer,
  showFocusRing = true,
  scrollContent = false,
}: {
  progress?: React.ReactNode;
  scrollContent?: boolean;
  name: string;
  description: string;
  /** Focus target on every step change. Rendered on the question heading. */
  headingRef?: React.Ref<HTMLHeadingElement>;
  children: React.ReactNode;
  footer: React.ReactNode;
  /** Whether the heading should render its focus ring the next time it
   *  receives focus. `true` (the default) for a keyboard-driven step change
   *  and for the initial, never-focused render; `false` for a
   *  pointer-driven one, so a mouse user isn't shown a ring around a
   *  heading that isn't interactive. The focus move itself (see
   *  `headingRef`) happens either way — this only ever changes whether the
   *  ring is visible once focus lands. See `setup-wizard.tsx`'s `goTo`. */
  showFocusRing?: boolean;
}): React.JSX.Element {
  return (
    <section
      className={`shell-docs-radius-surface not-prose flex min-h-[30rem] flex-col p-5 sm:h-[32rem] sm:p-7 border border-[color-mix(in_srgb,var(--text)_18%,var(--bg-surface))] bg-[color-mix(in_srgb,var(--text)_6%,var(--bg-surface))]`}
    >
      {progress && <div className="mb-6 shrink-0">{progress}</div>}
      <h3
        ref={headingRef}
        tabIndex={-1}
        className={`mt-1 text-center text-xl font-semibold tracking-[-0.02em] text-[var(--text)] outline-none sm:text-[1.375rem] ${
          showFocusRing ? HEADING_FOCUS_RING_CLASS : ""
        }`}
      >
        {name}
      </h3>
      <p className="mt-1.5 text-center text-sm leading-relaxed text-[var(--text-secondary)]">
        {description}
      </p>
      <div
        className={`mt-6 flex min-h-0 flex-1 flex-col ${scrollContent ? "max-h-80 overflow-y-auto pr-2 sm:max-h-none" : ""}`}
      >
        {children}
      </div>
      {footer && (
        <div data-testid="wizard-footer" className="shrink-0 pt-5">
          {footer}
        </div>
      )}
    </section>
  );
}

/** One option for `ChoiceGrid` below: a plain labelled choice with no logo,
 *  optionally with a short supporting line, and an icon that stands for the
 *  choice itself. */
export type ChoiceOption = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  /** A real `lucide-react` icon component, handed in by the caller as a
   *  named import (see `PROJECT_ANSWER_ICONS` above) — this module has no
   *  option ids of its own to key a lookup record against, so the component
   *  itself is the prop rather than a name string. Decorative: `ChoiceGrid`
   *  always renders it `aria-hidden`, next to the option's own visible
   *  label. */
  readonly icon: LucideIcon;
};

/** Single-choice buttons advance immediately and retain their selection on Back. */
export function ChoiceGrid({
  options,
  selectedId,
  disabled,
  onSelect,
}: {
  options: readonly ChoiceOption[];
  selectedId?: string;
  disabled: boolean;
  onSelect: (id: string, pointerActivated: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((option) => {
        const selected = option.id === selectedId;
        const Icon = option.icon;
        return (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={(event) => onSelect(option.id, event.detail > 0)}
            className={`shell-docs-radius-control block w-full cursor-pointer border px-3 py-7 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              selected
                ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                : "border-[color-mix(in_srgb,var(--text)_18%,var(--bg-surface))] bg-[var(--bg-surface)] shadow-sm hover:border-[var(--accent)]"
            }`}
          >
            <span className="flex flex-col items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center text-[var(--text-secondary)]">
                <Icon
                  aria-hidden="true"
                  className="h-9 w-9"
                  strokeWidth={1.5}
                />
              </span>
              <span className="text-sm font-semibold text-[var(--text)]">
                {option.label}
              </span>
            </span>
            {option.description ? (
              <span className="mt-2.5 block text-xs leading-relaxed text-[var(--text-muted)]">
                {option.description}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** The Back/hint/Continue footer row. Back is omitted entirely — not merely
 *  hidden — when `onBack` is absent. Continue is always enabled; see the
 *  header comment above for why and for how `hint` is announced. The
 *  primary itself is optional: the review step passes no `onContinue`, and
 *  the row then renders Back alone on the left with nothing on the right.
 *
 *  Ordering is done with `order-*` rather than `flex-col-reverse`, since a
 *  reversed column only has two visual slots (first/last) and this row can
 *  have up to four participants whose order differs by breakpoint: on `sm`
 *  and up it reads Back, hint, [secondaryAction+Continue] left to right, the
 *  bracketed pair rendered as one clustered flex item rather than two
 *  independently `justify-between`-spaced ones (see the wrapper below);
 *  below `sm`, stacked, it reads Continue, secondaryAction, Back, hint top
 *  to bottom — the buttons keep the same relative order as before (primary
 *  first), and the hint gets the last line. */
export function WizardNav({
  onBack,
  onContinue,
  continueLabel,
  continueIcon,
  hint,
  secondaryAction,
}: {
  /** `pointerActivated` is `event.detail > 0` — see the header comment
   *  above. Computed here, next to the click, so the caller only ever
   *  receives a boolean. */
  onBack?: (pointerActivated: boolean) => void;
  onContinue?: (pointerActivated: boolean) => void;
  continueLabel?: string;
  /** Rendered before the label — e.g. the clipboard glyph on the review
   *  step's copy button. An optional prop rather than asking every caller to
   *  build the whole button: every other step passes nothing and gets
   *  exactly the same button as before. */
  continueIcon?: React.ReactNode;
  /** A short instruction — e.g. "Choose your frontend first" — shown when
   *  the reader clicks Continue with the step's required choice still
   *  missing. `undefined`/empty on every step that has no required choice,
   *  and on a step that does as soon as the choice is made. Owned entirely
   *  by `setup-wizard.tsx`; this component only renders whatever it is
   *  given. */
  hint?: string;
  /** A second, quieter action grouped with Continue as a right-aligned pair
   *  — currently only the review step's "Set up manually" link to
   *  `/quickstart` (see `setup-wizard.tsx`), so a reader who would rather not
   *  copy a prompt still has an explicit way forward from the same row
   *  instead of hunting for it elsewhere. A plain `ReactNode` rather than a
   *  `{ label, href }` shape: this component has no reason to know about
   *  routing, only where the slot sits and that it shares Back's quiet
   *  treatment (`QUIET_BUTTON_CLASS`, exported for exactly this). `undefined`
   *  on every other step, and only ever rendered alongside `onContinue` —
   *  there is nothing for it to sit beside on the review step's own
   *  Back-only render. */
  secondaryAction?: React.ReactNode;
}): React.JSX.Element {
  // Built once so both branches below (grouped-with-secondary and
  // Continue-alone) render the identical button rather than two near-copies
  // that could drift apart. Its own `order-*` differs by branch: alone, it
  // is the row's fourth `justify-between` participant (`sm:order-4`,
  // matching Back=1/hint=2); grouped, it is the *second* item inside the
  // wrapper below (`sm:order-2`, secondary first) — the wrapper itself is
  // the row's third participant, not this button.
  const continueButton = onContinue ? (
    <button
      type="button"
      onClick={(event) => onContinue(event.detail > 0)}
      className={`${ACCENT_BUTTON_CLASS} ${PRIMARY_BUTTON_MIN_WIDTH_CLASS} ${
        secondaryAction ? "order-1 sm:order-2" : "order-1 sm:order-4"
      }`}
    >
      {continueIcon}
      {continueLabel}
    </button>
  ) : null;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {onBack ? (
        <button
          type="button"
          onClick={(event) => onBack(event.detail > 0)}
          className={`order-3 sm:order-1 ${QUIET_BUTTON_CLASS} max-w-fit self-start`}
        >
          Back
        </button>
      ) : null}
      {/* Always rendered, empty or not — a live region that only mounts once
       *  there is something to say would never get announced, since screen
       *  readers only pick up *changes* to an already-present polite region.
       *  Its width comes and goes with its text, but that cannot shift Back
       *  or the trailing group: both are `shrink-0` (the group's own
       *  Continue also has a fixed min-width), and `justify-between` on the
       *  row keeps the first and last items pinned to the row's own edges no
       *  matter how wide the middle item is. Below `sm` this becomes its own
       *  stacked line instead — the card has no minimum height on phones, so
       *  that line appearing or clearing there is free to reflow. */}
      <p
        aria-live="polite"
        className="order-4 text-xs leading-tight text-[var(--accent)] sm:order-2"
      >
        {hint ?? ""}
      </p>
      {onContinue && secondaryAction ? (
        // Secondary and primary rendered as one clustered flex item on `sm`
        // and up, not two independent participants in the row's own
        // `justify-between` — that spacing is what stranded "Set up
        // manually" midway between the hint and Copy prompt before this
        // change. `contents` below `sm` drops this wrapper out of the box
        // tree entirely, so its children fall back to being ordinary
        // top-level items of the stacked column (Continue still first, via
        // its own `order-1`); at `sm` and up the wrapper becomes a real flex
        // container with a small internal gap and is itself the row's third
        // `justify-between` participant.
        <div className="contents sm:order-3 sm:flex sm:shrink-0 sm:items-center sm:gap-3">
          <span className="order-2 shrink-0 sm:order-1">{secondaryAction}</span>
          {continueButton}
        </div>
      ) : (
        continueButton
      )}
    </div>
  );
}
