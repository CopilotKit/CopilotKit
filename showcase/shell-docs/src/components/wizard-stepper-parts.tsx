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
import { Check, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { CORE_TREATMENT_CLASS } from "./docs-map-parts";

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
 *  A checkmark for "yes", a cross for "no". A checkmark already marks a
 *  *selected* feature tile elsewhere in this wizard (`CapabilityGrid` in
 *  `docs-map-parts.tsx`), but there is no collision here: this step is
 *  single choice and renders no selection checkmark of its own (see
 *  `ChoiceGrid`'s header comment below), so the checkmark is free to carry
 *  the "yes" answer's own meaning instead.
 *
 *  Named imports in an explicit record, never `import * as icons` with a
 *  runtime index — see `docs-map-parts.tsx`'s `CAPABILITY_ICONS` comment for
 *  the bundle-size regression that guards against (605 KB minified for a
 *  namespace import indexed at runtime, vs. 6 KB for named imports). */
export const PROJECT_ANSWER_ICONS: Record<"yes" | "no", LucideIcon> = {
  yes: Check,
  no: X,
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
      {/* `data-testid` purely for test addressability: `setup-wizard.test.tsx`
       *  needs to assert the copy button and Back both live in the footer
       *  without depending on a specific parent node, since the footer's own
       *  primary/secondary pairing (see `WizardNav`'s `secondaryAction`
       *  handling below) puts Back and the copy button at different nesting
       *  depths. */}
      <div
        data-testid="wizard-footer"
        className="border-t border-[var(--border)] pt-5 sm:pt-6"
      >
        {footer}
      </div>
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

/** A short list of plain, labelled choices — currently only step 1's "Do you
 *  already have a project?" (Yes/No). `docs-map-parts.tsx`'s `PickGrid`
 *  doesn't fit here: it always renders a `PickLogoMark`, which needs a
 *  `MapPick.logo`, and a plain Yes/No choice has no logo to give it.
 *
 *  Each option is the same shape as `CapabilityGrid`'s feature tiles in
 *  `docs-map-parts.tsx`: the icon and label share the top row, the
 *  description sits on its own line below, `p-3.5` padding, left-aligned,
 *  no minimum height. It used to be a tall card (`min-h-[13rem]`, icon
 *  stacked above a centred label) built specifically because two short,
 *  wide-and-thin tiles left roughly 218px of the step's ~292px content area
 *  empty; going back to this compact shape brings some of that air back; a
 *  fixed floor is no longer how this step fills its frame.
 *
 *  The icon is a checkmark for "yes" and a cross for "no" (`PROJECT_ANSWER_
 *  ICONS` above) — a reversal of an earlier decision that ruled a check/cross
 *  pair out for reading as right-and-wrong. It does not collide with a
 *  checkmark's other meaning in this wizard, marking a *selected*
 *  `CapabilityGrid` tile: this step is single choice and renders no
 *  selection checkmark of its own, same as `PickGrid` — the accent border
 *  and fill are the only selection signal here too.
 *
 *  Each option is a real `<button type="button">`: the real `disabled`
 *  attribute when the step is locked (matching every other option control in
 *  the wizard), `aria-pressed` for the selected one, and no `aria-label` —
 *  the accessible name is exactly the button's own visible text (label, then
 *  description when given; the icon is `aria-hidden` and contributes
 *  nothing to it), the same rule `PickGrid`/`CapabilityGrid` follow in
 *  `docs-map-parts.tsx`. */
/** Two fixed-width centred columns, not two halves of the row: a Yes/No pair
 *  stretched across the full width reads as flat and adrift in a card this
 *  tall. `12rem` is the width the frontend options get from their own
 *  auto-fill grid, so an option here is the same size as an option anywhere
 *  else in the wizard. Full width below `sm`, where there is no room to be
 *  choosy. */
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
    <div className="grid grid-cols-1 justify-center gap-2.5 sm:grid-cols-[repeat(2,minmax(0,12rem))]">
      {options.map((option) => {
        const selected = option.id === selectedId;
        const Icon = option.icon;
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
            <span className="flex items-center gap-2">
              <span className="shell-docs-radius-icon flex h-7 w-7 shrink-0 items-center justify-center border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--accent)]">
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />
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
          className={`order-3 sm:order-1 ${QUIET_BUTTON_CLASS}`}
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
