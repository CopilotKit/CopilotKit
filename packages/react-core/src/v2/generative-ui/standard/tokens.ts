/**
 * Design tokens of the standard components. Each token is a CSS variable
 * with a literal fallback, so a host can restyle a surface with the
 * `--a2ui-*` variables. A value that is not a token passes through as raw
 * CSS.
 */

/** Id of `standardUI`, the catalog id the model writes in createSurface. */
export const STANDARD_CATALOG_ID = "copilotkit/standard@1";

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
export type Radius = (typeof RADII)[number];

const RADIUS_PX: Record<Radius, string> = {
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
  // A semantic tint is a hint, not a block: the text color at low alpha.
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

function hasToken<Key extends string>(
  table: Record<Key, string>,
  key: string,
): key is Key {
  return Object.hasOwn(table, key);
}

/** A number is a count of 4px steps. A string passes through as CSS. */
export function spacing(value: number | string | undefined) {
  if (value === undefined) return undefined;
  return typeof value === "number"
    ? `calc(var(--spacing, 0.25rem) * ${value})`
    : value;
}

/** A radius token, a number of pixels, or raw CSS. */
export function radius(value: string | number | undefined) {
  if (value === undefined) return undefined;
  if (typeof value === "number") return `${value}px`;
  if (value === "full") return "9999px";
  return hasToken(RADIUS_PX, value)
    ? `var(--a2ui-radius-${value}, ${RADIUS_PX[value]})`
    : value;
}

/** A text color token, or a raw CSS color. */
export function textColor(value: string | undefined) {
  if (!value) return undefined;
  return hasToken(TEXT_COLOR_FALLBACK, value)
    ? `var(--a2ui-color-text-${value}, ${TEXT_COLOR_FALLBACK[value]})`
    : value;
}

/** A background token, or a raw CSS color. */
export function backgroundColor(value: string | undefined) {
  if (!value) return undefined;
  return hasToken(BG_FALLBACK, value)
    ? `var(--a2ui-color-${value}, ${BG_FALLBACK[value]})`
    : value;
}

/** The one inner panel of a Card: near-white fill. */
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
 * The background of a panel inside a Card. A neutral surface becomes the
 * near-white inner panel. A semantic tint gets lighter (about 6% alpha).
 * Solid and raw values go through `backgroundColor`.
 */
export function panelBackground(value: string | undefined) {
  if (!value) return undefined;
  const isNeutral =
    value === "surface-secondary" ||
    value === "surface-soft" ||
    value === "surface-elevated-secondary";
  if (isNeutral) return INNER_PANEL_BG;
  return hasToken(SOFT_TINT, value)
    ? `var(--a2ui-color-${value}-soft, ${SOFT_TINT[value]})`
    : backgroundColor(value);
}

/** A border color token, or a raw CSS color. */
export function borderColor(value: string | undefined) {
  if (!value) return undefined;
  return hasToken(BORDER_FALLBACK, value)
    ? `var(--a2ui-color-border-${value}, ${BORDER_FALLBACK[value]})`
    : value;
}

/**
 * The type scale at a 16px base, in em, so a surface scales with the font
 * size of the host: title lg = 18/28, 2xl = 24/32; text md = 16/26,
 * sm = 14/20, xs = 12/16, 3xs = 10/12. Line heights are unitless ratios.
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

/** Text on an accent fill (solid buttons and badges, selected segments). */
export const ON_ACCENT = "var(--a2ui-color-on-accent, #fff)";
/** The fill of a control (checkbox, radio, slider thumb, selected segment). */
export const CONTROL_BG = "var(--a2ui-color-control, #fff)";
export const SHADOW_XS = "var(--a2ui-shadow-xs, 0 1px 2px rgba(0,0,0,.12))";
export const SHADOW_SM = "var(--a2ui-shadow-sm, 0 1px 3px rgba(0,0,0,.12))";
export const SHADOW_SOFT = "var(--a2ui-shadow-soft, 0 1px 3px rgba(0,0,0,.06))";
export const SHADOW_MD = "var(--a2ui-shadow-md, 0 4px 12px rgba(0,0,0,.08))";
/** The moving highlight of a shimmer placeholder. */
export const SHIMMER_HIGHLIGHT =
  "var(--a2ui-color-shimmer, rgba(255,255,255,.55))";
/** The hover band behind a chart column. */
export const CHART_CURSOR = "var(--a2ui-color-chart-cursor, rgba(0,0,0,.04))";
/**
 * Chart series colors: a soft blue family first, then muted companions, so
 * a chart with many series stays easy to read. A host can change each one
 * with `--a2ui-chart-1`, `--a2ui-chart-2`, and so on.
 */
const CHART_PALETTE_FALLBACK = [
  "#7fb0f2",
  "#2f6fd1",
  "#b7cff7",
  "#8bb5a8",
  "#d9b36b",
  "#c08bb0",
];
export const CHART_PALETTE = CHART_PALETTE_FALLBACK.map(
  (hex, index) => `var(--a2ui-chart-${index + 1}, ${hex})`,
);

/**
 * A UI font stack. A surface inherits the font of the host. This value is
 * for hosts that want it (`font-family: var(--a2ui-font-family, ...)`).
 */
export const FONT_FAMILY =
  'var(--a2ui-font-family, -apple-system, ui-sans-serif, system-ui, "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol")';

/** The heading scale in em. */
export function titleFont(size: TitleSize = "md") {
  const [fontSize, lineHeight] = TITLE_SCALE[size];
  return { fontSize, lineHeight, fontWeight: 600 };
}

/** The body text size, in em of the text around it. */
export function textFont(size: TextSize = "md") {
  const [fontSize, lineHeight] = TEXT_SCALE[size];
  return { fontSize, lineHeight };
}

export const FONT_WEIGHT: Record<Weight, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};
