// Framework-free style helpers of the standard components. Each framework
// binds the returned style objects to its own elements.
import {
  SHADOW_SM,
  backgroundColor,
  borderColor,
  radius,
  spacing,
} from "./tokens";
import type { ALIGN, JUSTIFY } from "./tokens";
import type { LayoutProps } from "./layout";

/** An inline style object, with camelCase CSS properties as keys. */
export type StyleMap = Record<string, string | number | undefined>;

/**
 * Equal when the JSON is equal. Use it as the equality check of a computed
 * value over agent data, so a new object with the same content does not
 * trigger a redraw.
 */
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

/**
 * Cuts the text after `lines` lines, with an ellipsis.
 *
 * @param lines - The number of lines to show.
 */
export function lineClamp(lines: number): StyleMap {
  return {
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };
}

/** The `align-items` value of each `align` prop value. */
export const ALIGN_CSS: Record<(typeof ALIGN)[number], string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  baseline: "baseline",
  stretch: "stretch",
};

/** The `justify-content` value of each `justify` prop value. */
export const JUSTIFY_CSS: Record<(typeof JUSTIFY)[number], string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  spaceBetween: "space-between",
  spaceAround: "space-around",
  spaceEvenly: "space-evenly",
  stretch: "stretch",
};

/**
 * A CSS length: pixels when `value` is a number, the raw CSS when it is a
 * string, and `undefined` when it is not set.
 *
 * @example px(12) // "12px"
 */
export function px(value: number | string | undefined) {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

/**
 * The CSS of a `radius` prop: one radius for all corners, or one radius for
 * each corner.
 *
 * @param value - A radius token, a raw CSS value, or an object of corners.
 */
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
 * A copy of `style` without the undefined entries, so a later spread never
 * erases a value. An undefined longhand next to a shorthand is a removal:
 * clearing `row-gap` resets the `gap` shorthand in real browsers.
 */
export function defined(style: StyleMap): StyleMap {
  const result: StyleMap = {};
  for (const [key, value] of Object.entries(style)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/**
 * The `gap` of the layout props, with `rowGap` and `columnGap` winning over
 * it. A renderer can apply a style object in sorted key order (Angular does),
 * so `columnGap` would come before the `gap` shorthand and lose to it. A
 * longhand therefore sets both longhands and no shorthand.
 */
function gapStyle(props: LayoutProps): StyleMap {
  const gap = spacing(props.gap) ?? (props.disableAutoSpacing ? 0 : undefined);
  const rowGap = spacing(props.rowGap);
  const columnGap = spacing(props.columnGap);
  if (rowGap === undefined && columnGap === undefined) return { gap };
  return { rowGap: rowGap ?? gap, columnGap: columnGap ?? gap };
}

/**
 * The flex container CSS of the shared layout props (`align`, `gap`,
 * `padding`, `radius`, sizes and the rest). An unset prop gives no CSS.
 *
 * @param props - The layout props of a container component.
 */
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
    ...gapStyle(props),
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
