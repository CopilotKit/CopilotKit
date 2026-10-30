import type { CSSProperties } from "react";
import type { StandardProps } from "./types";

/** The shared layout props of the standard containers. */
export type LayoutProps = Omit<
  StandardProps<"Box">,
  "children" | "onVisible" | "direction"
>;

const RADII = new Set([
  "2xs",
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
]);
const TEXT_COLORS = new Set([
  "default",
  "prose",
  "primary",
  "emphasis",
  "secondary",
  "tertiary",
  "success",
  "info",
  "warning",
  "caution",
  "danger",
  "discovery",
]);
const BACKGROUNDS = new Set([
  "surface",
  "surface-secondary",
  "surface-tertiary",
  "surface-elevated",
  "surface-elevated-secondary",
  "surface-inverted",
  "surface-soft",
  "info",
  "warning",
  "caution",
  "success",
  "danger",
  "discovery",
  "info-solid",
  "warning-solid",
  "caution-solid",
  "success-solid",
  "danger-solid",
  "discovery-solid",
]);
const BORDER_COLORS = new Set([
  "default",
  "subtle",
  "strong",
  "info",
  "warning",
  "caution",
  "success",
  "danger",
  "discovery",
]);
const ALIGN: Record<string, string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  baseline: "baseline",
  stretch: "stretch",
};
const JUSTIFY: Record<string, string> = {
  start: "flex-start",
  end: "flex-end",
  center: "center",
  spaceBetween: "space-between",
  spaceAround: "space-around",
  spaceEvenly: "space-evenly",
  stretch: "stretch",
};

/** A number is a count of 4px steps. A string passes through as CSS. */
export function sizeOf(value: number | string | undefined) {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value * 4}px` : value;
}

/** A radius token, a number of pixels, or raw CSS. */
export function radiusOf(value: string | number | undefined) {
  if (value === undefined) return undefined;
  if (typeof value === "number") return `${value}px`;
  if (value === "full") return "9999px";
  return RADII.has(value) ? `var(--a2ui-radius-${value})` : value;
}

/** A text color token, or a raw CSS color. The theme maps tokens to Kumo. */
export function textColorOf(value: string | undefined) {
  if (!value) return undefined;
  return TEXT_COLORS.has(value) ? `var(--a2ui-color-text-${value})` : value;
}

/** A background token, or a raw CSS color. */
export function backgroundOf(value: string | undefined) {
  if (!value) return undefined;
  return BACKGROUNDS.has(value) ? `var(--a2ui-color-${value})` : value;
}

/** A border color token, or a raw CSS color. */
export function borderColorOf(value: string | undefined) {
  if (!value) return undefined;
  return BORDER_COLORS.has(value) ? `var(--a2ui-color-border-${value})` : value;
}

/** Removes the undefined entries, so a later spread never erases a value. */
export function defined(style: CSSProperties): CSSProperties {
  return Object.fromEntries(
    Object.entries(style).filter(([, value]) => value !== undefined),
  );
}

function radiusStyle(value: LayoutProps["radius"]): CSSProperties {
  if (value === undefined) return {};
  if (typeof value === "string" || typeof value === "number") {
    return { borderRadius: radiusOf(value) };
  }
  return {
    borderTopLeftRadius: radiusOf(value.topLeft),
    borderTopRightRadius: radiusOf(value.topRight),
    borderBottomLeftRadius: radiusOf(value.bottomLeft),
    borderBottomRightRadius: radiusOf(value.bottomRight),
  };
}

/**
 * The CSS of the standard layout props that were set, over the `--a2ui-*`
 * variables (./theme.ts maps them to Kumo). An unset prop gives no CSS, so
 * the Kumo component keeps its own look.
 */
export function layoutStyle(props: Partial<LayoutProps>): CSSProperties {
  return defined({
    alignItems: props.align ? ALIGN[props.align] : undefined,
    justifyContent: props.justify ? JUSTIFY[props.justify] : undefined,
    flexWrap: props.wrap,
    gap: sizeOf(props.gap),
    rowGap: sizeOf(props.rowGap),
    columnGap: sizeOf(props.columnGap),
    padding: props.flush ? 0 : sizeOf(props.padding),
    background: backgroundOf(props.background),
    border: props.border
      ? `1px solid ${borderColorOf(props.borderColor ?? "default")}`
      : undefined,
    ...radiusStyle(props.radius),
    width: sizeOf(props.width),
    height: sizeOf(props.height),
    minWidth: sizeOf(props.minWidth ?? props.minSize),
    maxWidth: sizeOf(props.maxWidth ?? props.maxSize),
    minHeight: sizeOf(props.minHeight ?? props.minSize),
    maxHeight: sizeOf(props.maxHeight ?? props.maxSize),
    flex: props.flex,
    flexGrow: props.weight,
    aspectRatio: props.aspectRatio,
    overflow: props.scrollable ? "auto" : props.clip ? "hidden" : undefined,
    boxShadow: props.shadow ? "var(--a2ui-shadow-sm)" : undefined,
  });
}

/** Hides text on screen but keeps it for screen readers. */
export const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};
