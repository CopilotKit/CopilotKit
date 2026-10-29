import { inject } from "@angular/core";
import { GenerativeUIStyles } from "../../styles";
import type { StyleMap } from "../style";

export const FEEDBACK_STYLE_ID = "a2ui-standard-feedback";

/**
 * The keyframes of the feedback components, and the rule for reduced
 * motion. Reduced is not none: the pulse ring keeps fading but no longer
 * grows (`data-a2ui-pulse`; `!important`, because the ring sets its
 * animation inline), because a status that does not move says nothing.
 * An element that moves has `data-a2ui-motion`.
 */
const FEEDBACK_CSS = [
  "@keyframes a2ui-pulse{0%{transform:scale(1);opacity:var(--a2ui-pulse-opacity,.6)}100%{transform:scale(var(--a2ui-pulse-scale,2.4));opacity:0}}",
  "@keyframes a2ui-pulse-fade{0%{opacity:var(--a2ui-pulse-opacity,.6)}100%{opacity:0}}",
  "[data-a2ui-feedback-button]:focus-visible{outline:2px solid var(--a2ui-color-focus, #0285ff);outline-offset:2px}",
  "@media (prefers-reduced-motion: reduce){[data-a2ui-pulse]{animation-name:a2ui-pulse-fade !important}}",
].join("\n");

/** Adds the standard stylesheet and the feedback stylesheet, once each. */
export function injectFeedbackStyles() {
  const styles = inject(GenerativeUIStyles);
  styles.ensureStandard();
  styles.ensure(FEEDBACK_STYLE_ID, FEEDBACK_CSS);
}

/** A native button without the browser look. */
export const BUTTON_RESET: StyleMap = {
  margin: 0,
  padding: 0,
  border: 0,
  background: "none",
  font: "inherit",
  color: "inherit",
  "text-align": "inherit",
  cursor: "pointer",
};
