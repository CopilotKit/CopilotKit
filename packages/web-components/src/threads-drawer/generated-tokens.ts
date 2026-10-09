/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Bundled default values for the drawer's design tokens, derived at build time
 * from the canonical react-core theme (`packages/react-core/src/v2/styles/globals.css`)
 * by `scripts/generate-tokens.ts`. Run `pnpm run gen:tokens` to regenerate.
 *
 * The drawer's shadow-DOM CSS references these as fallbacks, e.g.
 * `var(--cpk-drawer-bg, <built default>)`, so consumers can override every
 * token while the built-in skin stays in sync with react-core.
 */
export const GENERATED_DRAWER_TOKEN_DEFAULTS = {
  bg: "oklch(1 0 0)",
  fg: "oklch(0.145 0 0)",
  surface: "oklch(1 0 0)",
  "surface-fg": "oklch(0.145 0 0)",
  muted: "oklch(0.97 0 0)",
  "muted-fg": "oklch(0.556 0 0)",
  accent: "oklch(0.97 0 0)",
  "accent-fg": "oklch(0.205 0 0)",
  primary: "oklch(0.205 0 0)",
  "primary-fg": "oklch(0.985 0 0)",
  danger: "oklch(0.577 0.245 27.325)",
  border: "oklch(0.922 0 0)",
  ring: "oklch(0.708 0 0)",
  radius: "0.625rem",
} as const satisfies Record<string, string>;

export type GeneratedDrawerTokenKey =
  keyof typeof GENERATED_DRAWER_TOKEN_DEFAULTS;
