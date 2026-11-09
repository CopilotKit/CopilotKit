import { onBeforeMount } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import {
  FOCUS_RING,
  FONT_WEIGHT,
  lineClamp,
  spacing,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type { typographySchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";

/** The typography props that Title, Text and ShimmerText share. */
export type TypographyProps = z.output<typeof typographySchema>;

/**
 * The CSS of the shared typography props. A prop that is not set gives no
 * CSS, so the text takes it from the host.
 *
 * @param props - The typography props of a text component.
 */
export function typographyStyle(props: TypographyProps): CSSProperties {
  const clamp: CSSProperties = props.truncate
    ? { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
    : props.maxLines
      ? lineClamp(props.maxLines)
      : {};
  return {
    color: textColor(props.color),
    fontWeight: props.fontWeight ? FONT_WEIGHT[props.fontWeight] : undefined,
    textAlign: props.textAlign,
    fontStyle: props.italic ? "italic" : undefined,
    fontVariantNumeric: props.tabularNums ? "tabular-nums" : undefined,
    width: spacing(props.width),
    ...clamp,
  };
}

const TEXT_STYLE_ID = "a2ui-standard-text";
const TEXT_CSS = [
  "@keyframes a2ui-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}",
  "@media (prefers-reduced-motion:reduce){[data-a2ui-shimmer]{animation:none!important}}",
  `[data-a2ui-tooltip-trigger]:focus-visible{outline:${FOCUS_RING};outline-offset:2px}`,
].join("\n");

/**
 * Adds the standard stylesheet, the shimmer keyframes and the tooltip focus
 * ring to the document once. ShimmerText and Tooltip call it in their
 * `setup`. It runs before the component mounts, so nothing is added on the
 * server.
 */
export function useTextStyles() {
  useStandardStyles();
  onBeforeMount(() => {
    if (document.getElementById(TEXT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = TEXT_STYLE_ID;
    style.textContent = TEXT_CSS;
    document.head.appendChild(style);
  });
}
