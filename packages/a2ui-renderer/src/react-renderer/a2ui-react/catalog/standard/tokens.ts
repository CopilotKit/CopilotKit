import type React from "react";

/**
 * Design tokens for the standard catalog.
 * Every token maps to a CSS variable with a literal fallback so hosts can
 * restyle surfaces by setting `--a2ui-*` variables. Unknown values pass
 * through as raw CSS.
 */

export const STANDARD_CATALOG_ID =
  "https://copilotkit.ai/a2ui/catalogs/standard/v1";

export const TITLE_SIZES = [
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
] as const;
export const TEXT_SIZES = ["3xs", "2xs", "xs", "sm", "md", "lg"] as const;
export const WEIGHTS = ["normal", "medium", "semibold", "bold"] as const;
export const ALIGN = ["start", "center", "end", "baseline", "stretch"] as const;
export const JUSTIFY = [
  "start",
  "center",
  "end",
  "between",
  "around",
  "evenly",
] as const;
export const WRAP = ["nowrap", "wrap", "wrap-reverse"] as const;
export const RADII = [
  "2xs",
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "full",
] as const;
export const TEXT_COLORS = [
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
] as const;
export const BORDER_COLORS = [
  "default",
  "subtle",
  "strong",
  "info",
  "warning",
  "caution",
  "success",
  "danger",
  "discovery",
] as const;
export const BACKGROUNDS = [
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
] as const;

export type TitleSize = (typeof TITLE_SIZES)[number];
export type TextSize = (typeof TEXT_SIZES)[number];
export type Weight = (typeof WEIGHTS)[number];

const RADIUS_PX: Record<(typeof RADII)[number], string> = {
  "2xs": "2px",
  xs: "4px",
  sm: "6px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  "2xl": "20px",
  "3xl": "24px",
  "4xl": "32px",
  full: "9999px",
};
const TEXT_COLOR_FALLBACK: Record<string, string> = {
  default: "#0d0d0d",
  prose: "#0d0d0d",
  primary: "#0d0d0d",
  emphasis: "#000",
  secondary: "#676767",
  tertiary: "#8f8f8f",
  success: "#00805d",
  info: "#0068bc",
  warning: "#946200",
  caution: "#946200",
  danger: "#c1322c",
  discovery: "#7040c1",
};
const BG_FALLBACK: Record<string, string> = {
  surface: "#fff",
  "surface-secondary": "#f7f7f8",
  "surface-tertiary": "#ececec",
  "surface-elevated": "#fff",
  "surface-elevated-secondary": "#f7f7f8",
  "surface-inverted": "#0d0d0d",
  "surface-soft": "#fafafa",
  info: "#e6f1fb",
  warning: "#fff4e0",
  caution: "#fff4e0",
  success: "#e3f6ef",
  danger: "#fbe9e8",
  discovery: "#efe9fa",
  "info-solid": "#0068bc",
  "warning-solid": "#946200",
  "caution-solid": "#946200",
  "success-solid": "#00805d",
  "danger-solid": "#c1322c",
  "discovery-solid": "#7040c1",
};
const BORDER_FALLBACK: Record<string, string> = {
  default: "#e7e7e7",
  subtle: "#f0f0f0",
  strong: "#cfcfcf",
  info: "#9cc4ea",
  warning: "#e6c98a",
  caution: "#e6c98a",
  success: "#9ad9c3",
  danger: "#eeaaa6",
  discovery: "#c8b4ea",
};

const has = (table: Record<string, string>, key: string) =>
  Object.prototype.hasOwnProperty.call(table, key);

/** Numbers are 4px steps; strings pass through as CSS. */
export function spacing(n: number | string | undefined): string | undefined {
  if (n === undefined || n === null) return undefined;
  return typeof n === "number" ? `calc(var(--spacing, 0.25rem) * ${n})` : n;
}

export function radius(v: string | number | undefined): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") return `${v}px`;
  if (v === "full") return "9999px";
  return has(RADIUS_PX, v)
    ? `var(--a2ui-radius-${v}, ${RADIUS_PX[v as keyof typeof RADIUS_PX]})`
    : v;
}

export function textColor(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return has(TEXT_COLOR_FALLBACK, v)
    ? `var(--a2ui-color-text-${v}, ${TEXT_COLOR_FALLBACK[v]})`
    : v;
}

export function backgroundColor(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return has(BG_FALLBACK, v) ? `var(--a2ui-color-${v}, ${BG_FALLBACK[v]})` : v;
}

export function borderColor(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return has(BORDER_FALLBACK, v)
    ? `var(--a2ui-color-border-${v}, ${BORDER_FALLBACK[v]})`
    : v;
}

const TITLE_PX: Record<TitleSize, number> = {
  sm: 15,
  md: 17,
  lg: 21,
  xl: 25,
  "2xl": 32,
  "3xl": 40,
  "4xl": 48,
  "5xl": 56,
};
const TEXT_PX: Record<TextSize, number> = {
  "3xs": 10,
  "2xs": 11,
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
};

export function titleFont(size: TitleSize = "md"): React.CSSProperties {
  return {
    fontSize: TITLE_PX[size] ?? TITLE_PX.md,
    lineHeight: 1.25,
    fontWeight: 600,
  };
}

export function textFont(size: TextSize = "md"): React.CSSProperties {
  return { fontSize: TEXT_PX[size] ?? TEXT_PX.md, lineHeight: 1.5 };
}

export const FONT_WEIGHT: Record<Weight, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};
