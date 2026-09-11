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
// The review step (the last of the five) has no forward action in the
// footer at all — its copy button moved into the card body, centred between
// the selection list and the footer, so it reads as the same accent control
// without being a second copy of
// `ACCENT_BUTTON_CLASS`/`PRIMARY_BUTTON_MIN_WIDTH_CLASS`. So
// `onContinue`/`continueLabel` are optional: with no `onContinue`, the row
// renders Back alone on the left and nothing on the right. Everything else
// about the row is unchanged.
//
// The `hint` is always rendered, whether or not `hint` itself is set, and is
// announced through `aria-live="polite"` rather than wired to the button via
// `aria-describedby`: a blocked click also moves focus into the step's
// option list (see `setup-wizard.tsx`), so by the time assistive technology
// would read a description, focus has already left the button — a polite
// live region is heard regardless of where focus lands, an
// `aria-describedby` on an element that is no longer focused would not be.
//
// On `sm` and up the hint sits inside the same row as the buttons — Back,
// then the hint, then Continue — rather than on a row of its own beneath
// them, so the footer has equal breathing room above and below the button
// row instead of the hint's line adding weight only to the bottom. It still
// cannot shift either button when its text appears or changes length: Back
// and Continue both carry `shrink-0` and Continue also a fixed min-width, so
// with the row set to `justify-between` the first and last items stay
// anchored to the row's own edges regardless of how wide the middle item
// (the hint) is. Below `sm` the footer stacks in a column instead, and there
// the hint gets its own line — the card has no minimum height on phones (see
// `WizardCard`'s doc comment), so that line coming and going costs nothing.
//
// `WizardNav`'s Back/Continue and `WizardProgress`'s rail buttons all hand
// their `on*` callback a `pointerActivated` boolean rather than the raw
// click event: `event.detail` is `0` for a keyboard-triggered click (Enter
// or Space) and greater than `0` for a real pointer click, and computing
// that here means `setup-wizard.tsx` only ever reasons about a plain
// boolean, not about `event.detail`. It flows into `WizardCard`'s
// `showFocusRing` prop, which decides whether the card's `<h2>` — focused on
// every step change, see that component's own comment — renders its focus
// ring the next time it receives focus. The move to the heading itself is
// unconditional either way; only the ring's visibility varies.

import React from "react";

import { CORE_TREATMENT_CLASS } from "./docs-map-parts";

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

// Exported so step 5's "Follow this guide" action (`setup-wizard.tsx`,
// handed in through `WizardNav`'s `secondaryAction` slot) renders with the
// same quiet treatment Back already uses, rather than a second copy of this
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
                onClick={(event) => onJump(step.n, event.detail > 0)}
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
 *  Measured in the running app at a card width of 644px, the four original
 *  steps' cards were 306, 516, 500 and 252px tall (the project question
 *  added since is shorter still) — the wizard sits at the bottom of the
 *  page, so every advance reflowed everything under it. `md:min-h-` gives
 *  the card a floor matching the tallest step (the 19-option agent backend
 *  list, 516px), and the flex column plus the footer's `mt-auto` keeps
 *  Back/Continue pinned to that same bottom edge on every step, so a short
 *  step's options sit at the top of an otherwise-empty card instead of the
 *  row also drifting.
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
  showFocusRing = true,
}: {
  step: number;
  total: number;
  name: string;
  description: string;
  /** Focus target on every step change. Rendered on the <h2>. */
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
      className={`shell-docs-radius-surface not-prose flex flex-col p-5 sm:p-6 md:min-h-[32rem] ${CORE_TREATMENT_CLASS}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {`Step ${step} of ${total}`}
      </p>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className={`mt-1 text-xl font-semibold tracking-[-0.02em] text-[var(--text)] outline-none sm:text-[1.375rem] ${
          showFocusRing ? HEADING_FOCUS_RING_CLASS : ""
        }`}
      >
        {name}
      </h2>
      <p className="mt-1.5 max-w-[64ch] text-sm leading-relaxed text-[var(--text-secondary)]">
        {description}
      </p>
      {/* `flex-1` so this box owns whatever room the card's floor leaves
       *  over, and `flex-col` so its child is laid out along that axis. A
       *  child that wants to fill the room instead of being centred in it
       *  opts in with a `flex-1` of its own; a percentage height would not
       *  work for that, since `height: 100%` against a flex item sized from
       *  `flex-basis: 0` resolves as auto. Nothing does today — the review
       *  step stretched itself this way until it read as three inflated
       *  boxes rather than a summary. */}
      {/* Symmetric padding, not a top margin, plus `justify-center`: the
       *  options then sit the same distance from the description above them
       *  as from the separator below. A top margin cannot do this — the
       *  footer's own padding lands *below* the separator, so it never pays
       *  for the gap above it, and the content area's whole margin showed up
       *  on one side only.
       *
       *  The two paddings together are deliberately the same total the single
       *  margin used to be: the card's `md:min-h` floor was measured against
       *  that total, and growing it would push the densest step past the
       *  floor and start the page moving between steps again. */}
      <div className="flex flex-1 flex-col justify-center py-2">{children}</div>
      {/* The footer's own top padding matches the card's bottom padding, so
       *  the button row sits the same distance from the separator above it as
       *  from the card's edge below it. Adding a bottom padding here instead
       *  stacks on top of the card's inset and makes the gap below the buttons
       *  more than twice the one above — the lopsided spacing this replaced.
       *  Keep these in step with the section's own `p-5 sm:p-6`.
       *
       *  No `mt-auto`: an auto margin absorbs a flex container's free space
       *  ahead of any `flex-1` sibling, which would starve the content area
       *  above and stop the review step's review grid from filling the card. The
       *  growing content area pushes this to the bottom on its own. */}
      <div className="border-t border-[var(--border)] pt-5 sm:pt-6">
        {footer}
      </div>
    </section>
  );
}

/** One option for `ChoiceGrid` below: a plain labelled choice with no logo,
 *  optionally with a short supporting line. */
export type ChoiceOption = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

/** A short list of plain, labelled choices — currently only step 1's "Do you
 *  already have a project?" (Yes/No). `docs-map-parts.tsx`'s `PickGrid`
 *  doesn't fit here: it always renders a `PickLogoMark`, which needs a
 *  `MapPick.logo`, and a plain Yes/No choice has no logo to give it. This
 *  control is built from the same option-button treatment `PickGrid`'s
 *  `size="card"` uses (the block layout, the border/fill tone, the
 *  disabled/cursor pairing) so the two read as one family of controls
 *  despite living in different files, rather than duplicating that file's
 *  private `pickButtonClass`/`optionToneClass` helpers here, which this
 *  module has no way to import (they aren't exported, and shouldn't be just
 *  for this).
 *
 *  Each option is a real `<button type="button">`: the real `disabled`
 *  attribute when the step is locked (matching every other option control in
 *  the wizard), `aria-pressed` for the selected one, and no `aria-label` —
 *  the accessible name is exactly the button's own visible text (label, then
 *  description when given), the same rule `PickGrid`/`CapabilityGrid` follow
 *  in `docs-map-parts.tsx`. */
export function ChoiceGrid({
  options,
  selectedId,
  disabled,
  onSelect,
}: {
  options: readonly ChoiceOption[];
  selectedId?: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {options.map((option) => {
        const selected = option.id === selectedId;
        return (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onSelect(option.id)}
            className={`shell-docs-radius-control block w-full cursor-pointer border p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              selected
                ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                : "border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)]"
            }`}
          >
            <span className="block text-sm font-semibold text-[var(--text)]">
              {option.label}
            </span>
            {option.description ? (
              <span className="mt-1 block text-xs leading-relaxed text-[var(--text-muted)]">
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
 *  and up it reads Back, hint, secondaryAction, Continue left to right;
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
  /** A second, quieter action rendered as a peer of Continue, immediately
   *  before it in visual order — currently only the review step's "Follow
   *  this guide" link to `/quickstart` (see `setup-wizard.tsx`), so a reader
   *  who would rather not copy a prompt still has an explicit way forward
   *  from the same row instead of hunting for it elsewhere. A plain
   *  `ReactNode` rather than a `{ label, href }` shape: this component has no
   *  reason to know about routing, only where the slot sits and that it
   *  shares Back's quiet treatment (`QUIET_BUTTON_CLASS`, exported for
   *  exactly this). `undefined` on every other step, and only ever rendered
   *  alongside `onContinue` — there is nothing for it to sit beside on the
   *  review step's own Back-only render. */
  secondaryAction?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {onBack ? (
        <button
          type="button"
          onClick={(event) => onBack(event.detail > 0)}
          className={`order-2 sm:order-1 ${QUIET_BUTTON_CLASS}`}
        >
          Back
        </button>
      ) : null}
      {/* Always rendered, empty or not — a live region that only mounts once
       *  there is something to say would never get announced, since screen
       *  readers only pick up *changes* to an already-present polite region.
       *  Its width comes and goes with its text, but that cannot shift Back
       *  or Continue: both are `shrink-0` (Continue also has a fixed
       *  min-width), and `justify-between` on the row keeps the first and
       *  last items pinned to the row's own edges no matter how wide the
       *  middle item is. Below `sm` this becomes its own stacked line
       *  instead — the card has no minimum height on phones, so that line
       *  appearing or clearing there is free to reflow. */}
      <p
        aria-live="polite"
        className="order-3 text-xs leading-tight text-[var(--accent)] sm:order-2"
      >
        {hint ?? ""}
      </p>
      {onContinue && secondaryAction ? (
        <span className="order-4 shrink-0 sm:order-3">{secondaryAction}</span>
      ) : null}
      {onContinue ? (
        <button
          type="button"
          onClick={(event) => onContinue(event.detail > 0)}
          className={`order-1 sm:order-4 ${ACCENT_BUTTON_CLASS} ${PRIMARY_BUTTON_MIN_WIDTH_CLASS}`}
        >
          {continueIcon}
          {continueLabel}
        </button>
      ) : null}
    </div>
  );
}
