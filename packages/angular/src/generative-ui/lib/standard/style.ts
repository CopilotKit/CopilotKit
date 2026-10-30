import {
  SHADOW_SM,
  backgroundColor,
  borderColor,
  radius,
  spacing,
} from "@copilotkit/shared/generative-ui";
import type {
  ALIGN,
  JUSTIFY,
  LayoutProps,
} from "@copilotkit/shared/generative-ui";

/** An inline style object, as `[style]` binds it. */
export type StyleMap = Record<string, string | number | undefined>;

/** Equal when the JSON is equal: the `equal` of a computed over agent data. */
export const jsonEqual = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Hides an element on screen. Screen readers still read it. */
export const VISUALLY_HIDDEN: StyleMap = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

/** The outline of a focused control, for a `:focus-visible` rule. */
export const FOCUS_RING = "2px solid var(--a2ui-color-focus, #0285ff)";

/** Cuts the text after `lines` lines, with an ellipsis. */
export function lineClamp(lines: number): StyleMap {
  return {
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };
}

/** The `align-items` of each `align` value. */
export const ALIGN_CSS: Record<(typeof ALIGN)[number], string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  baseline: "baseline",
  stretch: "stretch",
};

/** The `justify-content` of each `justify` value. */
const JUSTIFY_CSS: Record<(typeof JUSTIFY)[number], string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  spaceBetween: "space-between",
  spaceAround: "space-around",
  spaceEvenly: "space-evenly",
  stretch: "stretch",
};

/** Pixels when a number, raw CSS when a string. */
export function px(value: number | string | undefined) {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

/** The CSS of a `radius` prop: one radius, or one for each corner. */
export function radiusStyle(value: LayoutProps["radius"]): StyleMap {
  if (typeof value === "string" || typeof value === "number") {
    return { borderRadius: radius(value) };
  }
  if (value === undefined) return {};
  return {
    borderTopLeftRadius: radius(value.topLeft),
    borderTopRightRadius: radius(value.topRight),
    borderBottomLeftRadius: radius(value.bottomLeft),
    borderBottomRightRadius: radius(value.bottomRight),
  };
}

/**
 * Removes the undefined entries, so a later spread never erases a value. An
 * undefined longhand next to a shorthand is a removal: clearing `row-gap`
 * resets the `gap` shorthand in real browsers (jsdom does not model this).
 */
export function defined(style: StyleMap): StyleMap {
  const result: StyleMap = {};
  for (const [key, value] of Object.entries(style)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/** The CSS of the shared layout props. An unset prop gives no CSS. */
export function layoutStyle(props: LayoutProps): StyleMap {
  const overflow = props.scrollable
    ? "auto"
    : props.clip
      ? "hidden"
      : undefined;
  return defined({
    display: props.inline ? "inline-flex" : "flex",
    alignItems: props.align ? ALIGN_CSS[props.align] : undefined,
    justifyContent: props.justify ? JUSTIFY_CSS[props.justify] : undefined,
    flexWrap: props.wrap,
    gap: spacing(props.gap) ?? (props.disableAutoSpacing ? 0 : undefined),
    rowGap: spacing(props.rowGap),
    columnGap: spacing(props.columnGap),
    padding: props.flush ? 0 : spacing(props.padding),
    background: backgroundColor(props.background),
    border: props.border
      ? `1px solid ${borderColor(props.borderColor ?? "default")}`
      : undefined,
    ...radiusStyle(props.radius),
    width: spacing(props.width),
    height: spacing(props.height),
    // A container can shrink below its content and never gets wider than
    // its parent.
    minWidth: spacing(props.minWidth ?? props.minSize) ?? 0,
    maxWidth: spacing(props.maxWidth ?? props.maxSize) ?? "100%",
    minHeight: spacing(props.minHeight ?? props.minSize),
    maxHeight: spacing(props.maxHeight ?? props.maxSize),
    flex: props.flex,
    flexGrow: props.weight,
    aspectRatio: props.aspectRatio,
    overflow,
    boxShadow: props.shadow ? SHADOW_SM : undefined,
    boxSizing: "border-box",
  });
}
