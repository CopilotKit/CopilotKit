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
// focus-visible ring and the `min-h-11` touch target) plus a disabled
// treatment that button never needed. Back is quiet — `--text-muted`, no
// fill — at the same height so the row aligns, and is omitted entirely
// (not just hidden) when `onBack` is absent, which is how the wizard signals
// step 1. On narrow screens the row stacks with Continue first in the visual
// order, so the primary action is never below the fold on a phone; `onBack`
// absent or present, Continue stays anchored to where the row's trailing
// edge would be.

import React from "react";

import { CORE_TREATMENT_CLASS } from "./docs-map-parts";

export type StepperStep = {
  readonly n: number; // 1-based
  readonly label: string; // short, for the progress rail
};

const ACCENT_BUTTON_CLASS =
  "shell-docs-radius-control inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 border border-[var(--accent-fill)] bg-[var(--accent-fill)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--accent-fill)] sm:w-auto";

const QUIET_BUTTON_CLASS =
  "shell-docs-radius-control inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 border border-transparent px-4 text-sm font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none sm:w-auto";

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
                className={`flex w-full flex-col items-center gap-1 disabled:cursor-not-allowed ${
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
 *  the caller places `WizardNav`. */
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
      className={`shell-docs-radius-surface not-prose p-5 sm:p-6 ${CORE_TREATMENT_CLASS}`}
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
      <div className="mt-6 border-t border-[var(--border)] pt-4">{footer}</div>
    </section>
  );
}

/** The Back/Continue footer row. Back is omitted entirely — not merely
 *  hidden — when `onBack` is absent. */
export function WizardNav({
  onBack,
  onContinue,
  continueLabel,
  continueDisabled,
}: {
  onBack?: () => void;
  onContinue: () => void;
  continueLabel: string;
  continueDisabled: boolean;
}): React.JSX.Element {
  return (
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
        disabled={continueDisabled}
        className={`${ACCENT_BUTTON_CLASS} ${onBack ? "" : "sm:ml-auto"}`}
      >
        {continueLabel}
      </button>
    </div>
  );
}
