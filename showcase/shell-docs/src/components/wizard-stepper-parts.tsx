// Presentational pieces for the current setup question and its actions.

import React from "react";
import { AppWindow, SquarePlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CopilotKitMark } from "@/components/copilotkit-mark";

/** A running app versus an app to create, shared by the choice and review. */
export const PROJECT_ANSWER_ICONS: Readonly<Record<"yes" | "no", LucideIcon>> =
  {
    yes: AppWindow,
    no: SquarePlus,
  };

// Shared with the docs video carousel. The wizard's Continue and Copy prompt
// actions use the same accent control.
export const ACCENT_BUTTON_CLASS =
  "shell-docs-radius-control inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 border border-[var(--accent-fill)] bg-[var(--accent-fill)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none sm:w-auto";

// Used by the wizard's "Set up manually" link.
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
const PRIMARY_BUTTON_MIN_WIDTH_CLASS = "min-w-[9.5rem]";

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

/** One active step in the sidebar's content stage. */
export function WizardCard({
  name,
  description,
  headingRef,
  children,
  footer,
  showFocusRing = true,
}: {
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
    <section className="wizard-step-card shell-docs-radius-surface not-prose">
      <div>
        <h3
          ref={headingRef}
          tabIndex={-1}
          className={`wizard-step-heading font-semibold tracking-[-0.02em] text-[var(--text)] outline-none ${
            showFocusRing ? HEADING_FOCUS_RING_CLASS : ""
          }`}
        >
          {name}
        </h3>
        <p className="wizard-step-description text-sm leading-relaxed text-[var(--text-secondary)]">
          {description}
        </p>
        <div className="wizard-step-choices">{children}</div>
      </div>
      {footer && (
        <div data-testid="wizard-footer" className="shrink-0 pt-5">
          {footer}
        </div>
      )}
    </section>
  );
}

/** One labelled choice, optionally with a short supporting line. */
export type ChoiceOption = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: LucideIcon;
};

function ProjectChoicePreview({
  kind,
}: {
  kind: "yes" | "no";
}): React.JSX.Element {
  return (
    <span
      className={`wizard-project-preview wizard-project-preview--${kind}`}
      aria-hidden="true"
    >
      <span className="wizard-project-preview-window">
        <span className="wizard-project-preview-chrome">
          <i />
          <i />
          <i />
        </span>
        {kind === "yes" ? (
          <span className="wizard-project-preview-existing">
            <span className="wizard-project-preview-sidebar">
              <b />
              <i />
              <i />
              <i />
            </span>
            <span className="wizard-project-preview-content">
              <b />
              <i />
              <i />
            </span>
            <span className="wizard-project-preview-assistant">
              <span className="wizard-project-preview-assistant-brand">
                <CopilotKitMark />
                <span>CopilotKit</span>
              </span>
              <i />
              <i />
            </span>
          </span>
        ) : (
          <span className="wizard-project-preview-new">
            <SquarePlus size={30} strokeWidth={1.5} />
            <span>Start something new</span>
            <span className="wizard-project-preview-starters">
              <i />
              <i />
              <i />
            </span>
          </span>
        )}
      </span>
    </span>
  );
}

/** Single-choice buttons advance immediately and retain their selection on Back. */
export function ChoiceGrid({
  options,
  selectedId,
  onSelect,
  illustrated = false,
}: {
  options: readonly ChoiceOption[];
  selectedId?: string;
  onSelect: (id: string, pointerActivated: boolean) => void;
  illustrated?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`wizard-step-choice-grid${illustrated ? " wizard-step-choice-grid--illustrated" : ""}`}
    >
      {options.map((option) => {
        const selected = option.id === selectedId;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            onClick={(event) => onSelect(option.id, event.detail > 0)}
            className={`wizard-step-choice${illustrated ? " wizard-step-choice--illustrated" : ""} ${
              selected
                ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                : "border-[color-mix(in_srgb,var(--text)_18%,var(--bg-surface))] bg-[var(--bg-surface)] shadow-sm hover:border-[var(--accent)]"
            }`}
          >
            {illustrated && (option.id === "yes" || option.id === "no") ? (
              <ProjectChoicePreview kind={option.id} />
            ) : null}
            <span className="wizard-step-choice-main">
              {option.icon && !illustrated ? (
                <span className="wizard-step-choice-icon" aria-hidden="true">
                  <option.icon size={18} strokeWidth={1.8} />
                </span>
              ) : null}
              <span className="wizard-step-choice-copy">
                <span className="block text-sm font-semibold text-[var(--text)]">
                  {option.label}
                </span>
                {option.description ? (
                  <span className="wizard-step-choice-description block text-xs leading-relaxed text-[var(--text-muted)]">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The action row used for Features and the final prompt. */
export function WizardNav({
  onContinue,
  continueLabel,
  continueIcon,
  secondaryAction,
}: {
  onContinue: (pointerActivated: boolean) => void;
  continueLabel: string;
  continueIcon?: React.ReactNode;
  secondaryAction?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {secondaryAction}
      <button
        type="button"
        onClick={(event) => onContinue(event.detail > 0)}
        className={`${ACCENT_BUTTON_CLASS} ${PRIMARY_BUTTON_MIN_WIDTH_CLASS}`}
      >
        {continueIcon}
        {continueLabel}
      </button>
    </div>
  );
}
