import { onBeforeMount } from "vue";
import type { CSSProperties } from "vue";
import { FOCUS_RING } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";

/** The id of the `<style>` element of the feedback components. */
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
  `[data-a2ui-feedback-button]:focus-visible{outline:${FOCUS_RING};outline-offset:2px}`,
  "@media (prefers-reduced-motion: reduce){[data-a2ui-pulse]{animation-name:a2ui-pulse-fade !important}}",
].join("\n");

/**
 * Adds the standard stylesheet and the feedback stylesheet to the document,
 * once each. Every feedback component calls it in its `setup`. It runs
 * before the component mounts, so nothing is added on the server.
 */
export function useFeedbackStyles() {
  useStandardStyles();
  onBeforeMount(() => {
    if (document.getElementById(FEEDBACK_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FEEDBACK_STYLE_ID;
    style.textContent = FEEDBACK_CSS;
    document.head.appendChild(style);
  });
}

/** A native button without the browser look. */
export const BUTTON_RESET: CSSProperties = {
  margin: 0,
  padding: 0,
  border: 0,
  background: "none",
  font: "inherit",
  color: "inherit",
  textAlign: "inherit",
  cursor: "pointer",
};
