// wizard-stepper-parts.tsx — the chrome for the homepage setup wizard's
// classic one-card-at-a-time stepper: the progress rail above the card, the
// card shell itself, and the Back/Continue footer inside it.
//
// This module owns none of the wizard's state or copy — `./setup-wizard`
// tracks which step is current, which is the furthest the reader has
// reached, and what has been answered so far, and hands each component here
// the slice it needs. `WizardCard` reuses `CORE_TREATMENT_CLASS` exported
// from `./docs-map-parts` rather than a second copy of the same
// border/surface/shadow string, since that is the one step treatment this
// variant needs: a step the reader cannot reach yet is simply not rendered,
// so there is no locked or done treatment left to express here.
//
// `WizardProgress` renders every step as a real `<button type="button">` so
// the reader can jump back to any step already reached. A step beyond
// `furthest` carries the real `disabled` attribute — not just a dimming
// class — for the same reason `PickGrid`'s locked options used to: a
// disabled step must not take a click and must not be reachable by Tab.
// `aria-current="step"` marks the one step that is current, and only that
// one. The number stays visible at every width; the label hides below `sm`
// so the rail still reads at 375px without four chips wrapping onto their
// own lines.
//
// `WizardNav` is the footer row passed into `WizardCard`'s `footer` prop.
// Continue is the primary action and reuses the accent button treatment from
// `channels-start-prompt.tsx` (full class string, including the
// focus-visible ring and the `min-h-11` touch target). It is never disabled
// — a step with a required choice still missing catches the click in
// `setup-wizard.tsx` instead, which is also where the `hint` string below
// comes from. Back is quiet — `--text-muted`, no fill — at the same height
// so the row aligns, and is omitted entirely (not just hidden) when
// `onBack` is absent, which is how the wizard signals step 1. On narrow
// screens the row stacks with Continue first in the visual order, so the
// primary action is never below the fold on a phone; `onBack` absent or
// present, Continue stays anchored to where the row's trailing edge would
// be.
//
// The `hint` row beneath Continue is always rendered, whether or not `hint`
// itself is set, and is announced through `aria-live="polite"` rather than
// wired to the button via `aria-describedby`: a blocked click also moves
// focus into the step's option list (see `setup-wizard.tsx`), so by the
// time assistive technology would read a description, focus has already
// left the button — a polite live region is heard regardless of where focus
// lands, an `aria-describedby` on an element that is no longer focused
// would not be.

import React from "react";

import { CORE_TREATMENT_CLASS } from "./docs-map-parts";

export type StepperStep = {
  readonly n: number; // 1-based
  readonly label: string; // short, for the progress rail
};

// No `disabled:` variants — Continue is never rendered with the `disabled`
// attribute (see the header comment above), so styling for that state would
// be dead weight.
const ACCENT_BUTTON_CLASS =
  "shell-docs-radius-control inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 border border-[var(--accent-fill)] bg-[var(--accent-fill)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none sm:w-auto";

const QUIET_BUTTON_CLASS =
  "shell-docs-radius-control inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 border border-transparent px-4 text-sm font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none sm:w-auto";

// The primary button's label changes shape across the wizard — Skip vs.
// Continue on the earlier steps, then Copy prompt / Copied / Copy blocked
// once it doubles as step 4's copy button — and without a floor the button
// itself resized on every swap, which read as a layout hiccup rather than a
// label change. The floor is sized for "Copy blocked", the longest label
// this button ever shows (12 characters, one longer than "Copy prompt"):
// roughly its text at text-sm font-semibold, plus the icon and icon-label
// gap step 4's copy button adds, plus the button's own horizontal padding,
// with a little slack rather than a value that only just fits.
const PRIMARY_BUTTON_MIN_WIDTH_CLASS = "min-w-[9.5rem]";

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
  onJump: (n: number) => void;
}): React.JSX.Element {
  return (
    <ol className="mb-5 flex items-start gap-1 sm:gap-2">
      {steps.map((step, index) => {
        const isCurrent = step.n === current;
        const reached = step.n <= furthest;
        return (
          <React.Fragment key={step.n}>
            {index > 0 ? (
              <li
                aria-hidden="true"
                className={`mt-3.5 h-px flex-1 ${
                  reached ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                }`}
              />
            ) : null}
            <li className="min-w-0 flex-1">
              <button
                type="button"
                disabled={!reached}
                aria-current={isCurrent ? "step" : undefined}
                onClick={() => onJump(step.n)}
                className={`flex w-full cursor-pointer flex-col items-center gap-1 disabled:cursor-not-allowed ${
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
                      ? "border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]"
                      : "border-[var(--border)]"
                  }`}
                >
                  {step.n}
                </span>
                <span className="hidden truncate text-xs sm:block">
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

/** The card shell for the one step currently on screen. `footer` is where
 *  the caller places `WizardNav`.
 *
 *  Measured in the running app at a card width of 644px, the four steps'
 *  cards were 306, 516, 500 and 252px tall — the wizard sits at the bottom
 *  of the page, so every advance reflowed everything under it. `md:min-h-`
 *  gives the card a floor matching the tallest step (the 19-option agent
 *  backend list, 516px), and the flex column plus the footer's `mt-auto`
 *  keeps Back/Continue pinned to that same bottom edge on every step, so a
 *  short step's options sit at the top of an otherwise-empty card instead of
 *  the row also drifting.
 *
 *  Deliberately `md:` and up only, not unconditional: below `md` the option
 *  grid collapses toward a single column, so the backend step grows far
 *  taller than any floor worth setting, and forcing that tall a floor on a
 *  phone would trade a smaller shift for a much bigger one — an empty card
 *  most of the time. Do not "fix" this by dropping the prefix. */
export function WizardCard({
  step,
  total,
  name,
  description,
  headingRef,
  children,
  footer,
}: {
  step: number;
  total: number;
  name: string;
  description: string;
  /** Focus target on every step change. Rendered on the <h2>. */
  headingRef?: React.Ref<HTMLHeadingElement>;
  children: React.ReactNode;
  footer: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      className={`shell-docs-radius-surface not-prose flex flex-col p-5 sm:p-6 md:min-h-[32rem] ${CORE_TREATMENT_CLASS}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {`Step ${step} of ${total}`}
      </p>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="mt-1 text-xl font-semibold tracking-[-0.02em] text-[var(--text)] sm:text-[1.375rem]"
      >
        {name}
      </h2>
      <p className="mt-1.5 max-w-[64ch] text-sm leading-relaxed text-[var(--text-secondary)]">
        {description}
      </p>
      <div className="mt-4">{children}</div>
      <div className="mt-auto border-t border-[var(--border)] pt-4">
        {footer}
      </div>
    </section>
  );
}

/** The Back/Continue footer row. Back is omitted entirely — not merely
 *  hidden — when `onBack` is absent. Continue is always enabled; see the
 *  header comment above for why and for how `hint` is announced. */
export function WizardNav({
  onBack,
  onContinue,
  continueLabel,
  continueIcon,
  hint,
}: {
  onBack?: () => void;
  onContinue: () => void;
  continueLabel: string;
  /** Rendered before the label — e.g. the clipboard glyph on step 4's copy
   *  button. An optional prop rather than asking every caller to build the
   *  whole button: the other three steps pass nothing and get exactly the
   *  same button as before. */
  continueIcon?: React.ReactNode;
  /** A short instruction — e.g. "Choose your frontend first" — shown when
   *  the reader clicks Continue with the step's required choice still
   *  missing. `undefined`/empty on every step that has no required choice,
   *  and on a step that does as soon as the choice is made. Owned entirely
   *  by `setup-wizard.tsx`; this component only renders whatever it is
   *  given. */
  hint?: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={() => onBack()}
            className={QUIET_BUTTON_CLASS}
          >
            Back
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onContinue()}
          className={`${ACCENT_BUTTON_CLASS} ${PRIMARY_BUTTON_MIN_WIDTH_CLASS} ${onBack ? "" : "sm:ml-auto"}`}
        >
          {continueIcon}
          {continueLabel}
        </button>
      </div>
      {/* Always rendered, empty or not — an empty live region still occupies
       *  this line, which is what keeps the hint from reflowing the footer
       *  (and the card's pinned-to-the-bottom buttons with it) when it
       *  appears or clears. */}
      <p
        aria-live="polite"
        className="min-h-[1rem] text-xs leading-tight text-[var(--accent)] sm:text-right"
      >
        {hint ?? ""}
      </p>
    </div>
  );
}
