import type {
  BACKGROUNDS,
  BORDER_COLORS,
  RADII,
  TEXT_COLORS,
} from "./standard/tokens";

type TextColor = (typeof TEXT_COLORS)[number];
type BorderColor = (typeof BORDER_COLORS)[number];
type Background = (typeof BACKGROUNDS)[number];
type Radius = Exclude<(typeof RADII)[number], "full">;
type Tint = "info" | "warning" | "caution" | "success" | "danger" | "discovery";
type ChartSeries = 1 | 2 | 3 | 4 | 5 | 6;

/** Every CSS variable that the standard components read. */
export type GenerativeUIThemeVariable =
  | `--a2ui-color-text-${TextColor}`
  | `--a2ui-color-${Background}`
  | `--a2ui-color-border-${BorderColor}`
  | `--a2ui-color-${Tint}-soft`
  | `--a2ui-radius-${Radius}`
  | `--a2ui-chart-${ChartSeries}`
  | "--a2ui-color-accent"
  | "--a2ui-color-on-accent"
  | "--a2ui-color-panel"
  | "--a2ui-color-control"
  | "--a2ui-color-focus"
  | "--a2ui-color-shimmer"
  | "--a2ui-color-chart-cursor"
  | "--a2ui-color-slider-track"
  | "--a2ui-color-badge-secondary"
  | "--a2ui-color-border-control"
  | "--a2ui-color-highlight-green"
  | "--a2ui-color-highlight-orange"
  | "--a2ui-color-highlight-pink"
  | "--a2ui-color-backdrop"
  | "--a2ui-color-overlay"
  | "--a2ui-color-rating"
  | "--a2ui-shadow-xs"
  | "--a2ui-shadow-sm"
  | "--a2ui-shadow-soft"
  | "--a2ui-shadow-md"
  | "--a2ui-font-family"
  | "--a2ui-heading-margin"
  | "--a2ui-block-margin";

/** Values for the theme variables. A name that is not one is a type error. */
export type GenerativeUIThemeVariables = {
  [Variable in GenerativeUIThemeVariable]?: string;
};

/** The values of one color scheme, plus the map style of that scheme. */
export type GenerativeUIThemeValues = GenerativeUIThemeVariables & {
  /** A MapLibre style URL for the Map component. */
  mapStyle?: string;
};

/**
 * The look of generated UI. Values at the top level apply in light and in
 * dark mode. Values in `dark` replace them in dark mode. Dark mode is on
 * when an ancestor of the surface has the `dark` class, like the CopilotKit
 * chat.
 *
 * @example
 * ```ts
 * const theme: GenerativeUITheme = {
 *   "--a2ui-color-accent": "#d97706",
 *   "--a2ui-font-family": "Inter, sans-serif",
 *   dark: { "--a2ui-color-panel": "#1f2937" },
 * };
 * ```
 */
export type GenerativeUITheme = GenerativeUIThemeValues & {
  dark?: GenerativeUIThemeValues;
};

/**
 * The built-in dark values. The light values are the fallbacks in the
 * components, so a surface is light when no variable is set.
 */
export const DARK_THEME: GenerativeUIThemeVariables = {
  "--a2ui-color-text-default": "#ececec",
  "--a2ui-color-text-prose": "#ececec",
  "--a2ui-color-text-primary": "#ececec",
  "--a2ui-color-text-emphasis": "#fff",
  "--a2ui-color-text-secondary": "#b4b4b4",
  "--a2ui-color-text-tertiary": "#8e8e8e",
  "--a2ui-color-text-success": "#4fd1a5",
  "--a2ui-color-text-info": "#6cb6ff",
  "--a2ui-color-text-warning": "#e3b341",
  "--a2ui-color-text-caution": "#e3b341",
  "--a2ui-color-text-danger": "#ff7b72",
  "--a2ui-color-text-discovery": "#bc9cff",
  "--a2ui-color-surface": "#1f1f1f",
  "--a2ui-color-surface-secondary": "#2a2a2a",
  "--a2ui-color-surface-tertiary": "#3a3a3a",
  "--a2ui-color-surface-elevated": "#262626",
  "--a2ui-color-surface-elevated-secondary": "#2f2f2f",
  "--a2ui-color-surface-inverted": "#f2f2f2",
  "--a2ui-color-surface-soft": "#232323",
  "--a2ui-color-info": "rgba(80, 160, 255, 0.14)",
  "--a2ui-color-warning": "rgba(240, 180, 60, 0.14)",
  "--a2ui-color-caution": "rgba(240, 180, 60, 0.14)",
  "--a2ui-color-success": "rgba(60, 200, 150, 0.14)",
  "--a2ui-color-danger": "rgba(255, 110, 100, 0.14)",
  "--a2ui-color-discovery": "rgba(170, 130, 255, 0.14)",
  "--a2ui-color-info-soft": "rgba(80, 160, 255, 0.08)",
  "--a2ui-color-warning-soft": "rgba(240, 180, 60, 0.08)",
  "--a2ui-color-caution-soft": "rgba(240, 180, 60, 0.08)",
  "--a2ui-color-success-soft": "rgba(60, 200, 150, 0.08)",
  "--a2ui-color-danger-soft": "rgba(255, 110, 100, 0.08)",
  "--a2ui-color-discovery-soft": "rgba(170, 130, 255, 0.08)",
  "--a2ui-color-info-solid": "#3b8eea",
  "--a2ui-color-warning-solid": "#c99a2e",
  "--a2ui-color-caution-solid": "#c99a2e",
  "--a2ui-color-success-solid": "#2fae86",
  "--a2ui-color-danger-solid": "#e5534b",
  "--a2ui-color-discovery-solid": "#9a6ff0",
  "--a2ui-color-border-default": "rgba(255, 255, 255, 0.12)",
  "--a2ui-color-border-subtle": "rgba(255, 255, 255, 0.06)",
  "--a2ui-color-border-strong": "#4a4a4a",
  "--a2ui-color-border-info": "#2f5f8f",
  "--a2ui-color-border-warning": "#6b5420",
  "--a2ui-color-border-caution": "#6b5420",
  "--a2ui-color-border-success": "#1f5f4b",
  "--a2ui-color-border-danger": "#7a2f2b",
  "--a2ui-color-border-discovery": "#4f3a80",
  "--a2ui-color-border-control": "rgba(255, 255, 255, 0.2)",
  "--a2ui-color-accent": "#f2f2f2",
  "--a2ui-color-on-accent": "#0d0d0d",
  "--a2ui-color-panel": "#262626",
  "--a2ui-color-control": "#2f2f2f",
  "--a2ui-color-focus": "#3b9bff",
  "--a2ui-color-shimmer": "rgba(255, 255, 255, 0.12)",
  "--a2ui-color-chart-cursor": "rgba(255, 255, 255, 0.06)",
  "--a2ui-color-slider-track": "rgba(255, 255, 255, 0.1)",
  "--a2ui-color-badge-secondary": "rgba(255, 255, 255, 0.08)",
  "--a2ui-color-highlight-green": "#1d4a37",
  "--a2ui-color-highlight-orange": "#4d3418",
  "--a2ui-color-highlight-pink": "#4d2338",
  "--a2ui-shadow-xs": "0 1px 2px rgba(0, 0, 0, 0.5)",
  "--a2ui-shadow-sm": "0 1px 3px rgba(0, 0, 0, 0.5)",
  "--a2ui-shadow-soft": "0 1px 3px rgba(0, 0, 0, 0.3)",
  "--a2ui-shadow-md": "0 4px 12px rgba(0, 0, 0, 0.4)",
};

const VARIABLE_NAME = /^--a2ui-[a-z0-9-]+$/;
// A value goes into a stylesheet, so it must not be able to end the rule or
// the element.
const UNSAFE_VALUE = /[{};<>]/;

/** Matches the `dark` class on an ancestor of a surface, or on the surface. */
const DARK = ":where(.dark)";

/** The default dark values, as a rule that any theme rule beats. */
export const DARK_THEME_CSS = `:where(.dark .a2ui-surface,.a2ui-surface.dark){${declarations(DARK_THEME)}}`;

function declarations(values: GenerativeUIThemeValues | undefined) {
  return Object.entries(values ?? {})
    .filter(
      ([name, value]) =>
        VARIABLE_NAME.test(name) &&
        typeof value === "string" &&
        !UNSAFE_VALUE.test(value),
    )
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
}

/** A short, stable id for a stylesheet. */
function hashOf(text: string) {
  let hash = 5381;
  for (let index = 0; index < text.length; index++) {
    hash = (hash * 33) ^ text.charCodeAt(index);
  }
  return `t${(hash >>> 0).toString(36)}`;
}

/**
 * The stylesheet of a theme: its values on the surfaces that carry its id,
 * then its dark values in dark mode. `undefined` when the theme sets no
 * variable. Values that could break out of the rule are left out.
 *
 * @example
 * ```ts
 * themeStyleSheet({ "--a2ui-color-accent": "red" });
 * // { id: "t…", css: '[data-a2ui-theme="t…"]{--a2ui-color-accent:red}' }
 * ```
 */
export function themeStyleSheet(theme: GenerativeUITheme | undefined) {
  const { dark, ...base } = theme ?? {};
  const both = declarations(base);
  const darkOnly = declarations(dark);
  if (!both && !darkOnly) return undefined;
  const id = hashOf(`${both}|${darkOnly}`);
  const self = `[data-a2ui-theme="${id}"]`;
  const rules = [
    both && `${self}{${both}}`,
    darkOnly && `${DARK} ${self},${self}${DARK}{${darkOnly}}`,
  ].filter(Boolean);
  return { id, css: rules.join("") };
}
