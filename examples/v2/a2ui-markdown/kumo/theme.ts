import { ChartPalette } from "@cloudflare/kumo";
import type {
  GenerativeUITheme,
  GenerativeUIThemeVariables,
} from "@copilotkit/react-core/v2/generative-ui";

/** A Kumo color token. */
const color = (token: string) => `var(--color-kumo-${token})`;
/** A Kumo text color token. */
const text = (token: string) => `var(--text-color-kumo-${token})`;
/** `token` at `percent` strength over the Kumo base color. */
const tint = (token: string, percent: number) =>
  `color-mix(in oklab, ${color(token)} ${percent}%, ${color("base")})`;
/** `token` at `percent` opacity. */
const alpha = (token: string, percent: number) =>
  `color-mix(in oklab, ${color(token)} ${percent}%, transparent)`;

/**
 * Every `--a2ui-*` variable, set to a Kumo token. The standard components
 * that have no Kumo counterpart read these, so they match the Kumo ones.
 * Kumo tokens use `light-dark()`, so dark mode follows Kumo's `data-mode`.
 */
export const kumoThemeValues = {
  "--a2ui-color-text-default": text("default"),
  "--a2ui-color-text-prose": text("default"),
  "--a2ui-color-text-primary": text("default"),
  "--a2ui-color-text-emphasis": text("strong"),
  "--a2ui-color-text-secondary": text("subtle"),
  "--a2ui-color-text-tertiary": text("inactive"),
  "--a2ui-color-text-success": text("success"),
  "--a2ui-color-text-info": text("info"),
  "--a2ui-color-text-warning": text("warning"),
  "--a2ui-color-text-caution": text("warning"),
  "--a2ui-color-text-danger": text("danger"),
  "--a2ui-color-text-discovery": color("badge-purple"),

  "--a2ui-color-surface": color("base"),
  "--a2ui-color-surface-secondary": color("elevated"),
  "--a2ui-color-surface-tertiary": color("recessed"),
  "--a2ui-color-surface-elevated": color("base"),
  "--a2ui-color-surface-elevated-secondary": color("elevated"),
  "--a2ui-color-surface-inverted": color("contrast"),
  "--a2ui-color-surface-soft": color("canvas"),
  "--a2ui-color-info": color("info-tint"),
  "--a2ui-color-warning": color("warning-tint"),
  "--a2ui-color-caution": color("warning-tint"),
  "--a2ui-color-success": color("success-tint"),
  "--a2ui-color-danger": color("danger-tint"),
  "--a2ui-color-discovery": tint("badge-purple", 10),
  "--a2ui-color-info-solid": color("info"),
  "--a2ui-color-warning-solid": color("warning"),
  "--a2ui-color-caution-solid": color("warning"),
  "--a2ui-color-success-solid": color("success"),
  "--a2ui-color-danger-solid": color("danger"),
  "--a2ui-color-discovery-solid": color("badge-purple"),
  "--a2ui-color-info-soft": tint("info-tint", 60),
  "--a2ui-color-warning-soft": tint("warning-tint", 60),
  "--a2ui-color-caution-soft": tint("warning-tint", 60),
  "--a2ui-color-success-soft": tint("success-tint", 60),
  "--a2ui-color-danger-soft": tint("danger-tint", 60),
  "--a2ui-color-discovery-soft": tint("badge-purple", 6),

  "--a2ui-color-border-default": color("line"),
  "--a2ui-color-border-subtle": color("hairline"),
  "--a2ui-color-border-strong": color("interact"),
  "--a2ui-color-border-info": tint("info", 40),
  "--a2ui-color-border-warning": tint("warning", 40),
  "--a2ui-color-border-caution": tint("warning", 40),
  "--a2ui-color-border-success": tint("success", 40),
  "--a2ui-color-border-danger": tint("danger", 40),
  "--a2ui-color-border-discovery": tint("badge-purple", 40),
  "--a2ui-color-border-control": color("line"),

  "--a2ui-color-accent": color("brand"),
  "--a2ui-color-on-accent": text("inverse"),
  "--a2ui-color-panel": color("elevated"),
  "--a2ui-color-control": color("control"),
  "--a2ui-color-focus": color("brand"),
  "--a2ui-color-shimmer": alpha("base", 55),
  "--a2ui-color-chart-cursor": alpha("contrast", 4),
  "--a2ui-color-slider-track": color("fill"),
  "--a2ui-color-badge-secondary": color("tint"),
  "--a2ui-color-highlight-green": color("success-tint"),
  "--a2ui-color-highlight-orange": color("warning-tint"),
  "--a2ui-color-highlight-pink": tint("badge-red", 15),
  "--a2ui-color-backdrop": alpha("contrast", 70),
  "--a2ui-color-overlay": alpha("contrast", 55),
  "--a2ui-color-rating": color("warning"),

  "--a2ui-radius-2xs": "var(--radius-xs)",
  "--a2ui-radius-xs": "var(--radius-sm)",
  "--a2ui-radius-sm": "var(--radius-md)",
  "--a2ui-radius-md": "var(--radius-lg)",
  "--a2ui-radius-lg": "var(--radius-xl)",
  "--a2ui-radius-xl": "var(--radius-xl)",
  "--a2ui-radius-2xl": "1rem",
  "--a2ui-radius-3xl": "1.25rem",
  "--a2ui-radius-4xl": "1.5rem",

  "--a2ui-chart-1": ChartPalette.categorical(0, false),
  "--a2ui-chart-2": ChartPalette.categorical(1, false),
  "--a2ui-chart-3": ChartPalette.categorical(2, false),
  "--a2ui-chart-4": ChartPalette.categorical(3, false),
  "--a2ui-chart-5": ChartPalette.categorical(4, false),
  "--a2ui-chart-6": ChartPalette.categorical(5, false),

  "--a2ui-shadow-xs": `0 1px 2px ${color("shadow-drop")}`,
  "--a2ui-shadow-sm": `0 0 0 1px ${color("shadow-edge")}, 0 1px 2px ${color("shadow-drop")}`,
  "--a2ui-shadow-soft": `0 1px 3px ${color("shadow-drop")}`,
  "--a2ui-shadow-md": `0 4px 12px ${color("shadow-drop")}`,
  "--a2ui-font-family": "var(--font-sans), system-ui, sans-serif",
  "--a2ui-heading-margin": "0",
  "--a2ui-block-margin": "0",
} satisfies Required<GenerativeUIThemeVariables>;

/** The theme of the /kumo pages: light and dark values come from Kumo. */
export const kumoTheme: GenerativeUITheme = kumoThemeValues;
