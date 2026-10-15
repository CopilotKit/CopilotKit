import type React from "react";

/**
 * Design tokens for the standard catalog, modelled on ChatGPT Intelligent UI.
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
  secondary: "#5d5d5d",
  tertiary: "#8e8e8e",
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
  "surface-soft": "#fcfcfc",
  // Semantic tints read as hints, not blocks: the text colour at low alpha.
  info: "rgba(0, 104, 188, 0.08)",
  warning: "rgba(148, 98, 0, 0.08)",
  caution: "rgba(148, 98, 0, 0.08)",
  success: "rgba(0, 128, 93, 0.08)",
  danger: "rgba(193, 50, 44, 0.08)",
  discovery: "rgba(112, 64, 193, 0.08)",
  "info-solid": "#0068bc",
  "warning-solid": "#946200",
  "caution-solid": "#946200",
  "success-solid": "#00805d",
  "danger-solid": "#c1322c",
  "discovery-solid": "#7040c1",
};
const BORDER_FALLBACK: Record<string, string> = {
  default: "rgba(0, 0, 0, 0.1)",
  subtle: "rgba(0, 0, 0, 0.05)",
  strong: "#cdcdcd",
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

/** ChatGPT's single inner panel: near-white fill, 8px radius, 12px padding. */
export const INNER_PANEL_BG = "var(--a2ui-color-panel, rgb(252, 252, 252))";
const SOFT_TINT: Record<string, string> = {
  info: "rgba(0, 104, 188, 0.06)",
  warning: "rgba(148, 98, 0, 0.06)",
  caution: "rgba(148, 98, 0, 0.06)",
  success: "rgba(0, 128, 93, 0.06)",
  danger: "rgba(193, 50, 44, 0.06)",
  discovery: "rgba(112, 64, 193, 0.06)",
};

/**
 * Background of a panel nested inside a Card: neutral surfaces collapse to
 * the near-white inner panel, semantic tints get even lighter (~6% alpha),
 * solid/raw values pass through `backgroundColor`.
 */
export function panelBackground(v: string | undefined): string | undefined {
  if (!v) return undefined;
  if (
    v === "surface-secondary" ||
    v === "surface-soft" ||
    v === "surface-elevated-secondary"
  ) {
    return INNER_PANEL_BG;
  }
  return has(SOFT_TINT, v)
    ? `var(--a2ui-color-${v}-soft, ${SOFT_TINT[v]})`
    : backgroundColor(v);
}

export function borderColor(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return has(BORDER_FALLBACK, v)
    ? `var(--a2ui-color-border-${v}, ${BORDER_FALLBACK[v]})`
    : v;
}

/**
 * Type scale measured from ChatGPT's rendered DIL surfaces at a 16px base,
 * expressed in em so surfaces scale with the host's font size:
 * title lg = 18/28, 2xl = 24/32 (Tailwind-like steps around them);
 * text md = 16/26, sm = 14/20, xs = 12/16, 3xs = 10/12.
 * Line heights are unitless ratios.
 */
const TITLE_SCALE: Record<TitleSize, [string, number]> = {
  sm: [".875em", 1.429],
  md: ["1em", 1.5],
  lg: ["1.125em", 1.556],
  xl: ["1.25em", 1.4],
  "2xl": ["1.5em", 1.333],
  "3xl": ["1.875em", 1.2],
  "4xl": ["2.25em", 1.111],
  "5xl": ["3em", 1.083],
};
const TEXT_SCALE: Record<TextSize, [string, number]> = {
  "3xs": [".625em", 1.2],
  "2xs": [".6875em", 1.273],
  xs: [".75em", 1.333],
  sm: [".875em", 1.429],
  md: ["1em", 1.625],
  lg: ["1.125em", 1.556],
};

/**
 * ChatGPT's UI font stack. Surfaces inherit the host's font instead; kept
 * for backwards compatibility and for hosts that want it
 * (`font-family: var(--a2ui-font-family, …)`).
 */
export const FONT_FAMILY =
  'var(--a2ui-font-family, -apple-system, ui-sans-serif, system-ui, "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol")';

/**
 * Heading scale in em. `Title` no longer uses it (it inherits the host's
 * heading styles); kept for backwards compatibility.
 */
export function titleFont(size: TitleSize = "md"): React.CSSProperties {
  const [fontSize, lineHeight] = TITLE_SCALE[size] ?? TITLE_SCALE.md;
  return { fontSize, lineHeight, fontWeight: 600 };
}

/** Body text size in em relative to the surrounding text. */
export function textFont(size: TextSize = "md"): React.CSSProperties {
  const [fontSize, lineHeight] = TEXT_SCALE[size] ?? TEXT_SCALE.md;
  return { fontSize, lineHeight };
}

export const FONT_WEIGHT: Record<Weight, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};
