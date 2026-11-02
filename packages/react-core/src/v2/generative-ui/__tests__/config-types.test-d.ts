// Type-only assertions, read by `tsc --noEmit` (`check-types`), never executed.
// Same mechanism as `v2/__tests__/headless-type-exports.test-d.ts`.
import { expectTypeOf } from "vitest";
import { createGenerativeUI } from "../catalog";
import type {
  GenerativeUIConfig,
  GenerativeUIMarkdownConfig,
  GenerativeUIToolConfig,
} from "../runtime-context";

const ui = createGenerativeUI({ id: "types", components: {} });

// A config without `transport` is the tool config.
expectTypeOf({ ui }).toMatchTypeOf<GenerativeUIToolConfig>();
expectTypeOf({ ui }).not.toMatchTypeOf<GenerativeUIMarkdownConfig>();

export const markdown: GenerativeUIConfig = {
  ui,
  transport: "markdown",
  sendContext: false,
  includeCatalog: false,
};

// tsc reports these two on the declaration line, not on the property.
// @ts-expect-error sendContext exists only on the markdown transport
export const tool: GenerativeUIConfig = {
  ui,
  transport: "tool",
  sendContext: false,
};

// @ts-expect-error includeCatalog exists only on the markdown transport
export const toolWithoutTransport: GenerativeUIConfig = {
  ui,
  includeCatalog: false,
};

export const themed: GenerativeUIConfig = {
  ui,
  theme: {
    "--a2ui-color-accent": "#4f46e5",
    mapStyle: "https://x/style",
    dark: { "--a2ui-color-panel": "#1f2937", mapStyle: "https://x/dark" },
  },
};

export const unknownVariable: GenerativeUIConfig = {
  ui,
  theme: {
    // @ts-expect-error not a variable that the standard components read
    "--a2ui-color-acent": "#4f46e5",
  },
};

export const unknownDarkVariable: GenerativeUIConfig = {
  ui,
  theme: {
    dark: {
      // @ts-expect-error not a variable that the standard components read
      "--a2ui-color-primary": "#000",
    },
  },
};

export const badThemeKey: GenerativeUIConfig = {
  ui,
  // @ts-expect-error theme keys are `--a2ui-*` variables or mapStyle
  theme: { color: "red" },
};
