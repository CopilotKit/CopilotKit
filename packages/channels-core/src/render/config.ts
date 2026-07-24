import type { RenderFont } from "@copilotkit/channels-ui";

/** Channel-wide image-render configuration (fonts + compiled CSS). */
export interface RenderConfig {
  /** Fonts registered for rendering (Takumi has no system fonts). Also accepts `googleFonts()` output. */
  fonts?: ReadonlyArray<RenderFont>;
  /** Compiled CSS strings (e.g. your Tailwind/global.css). Resolves class selectors, `var()`, oklch. */
  stylesheets?: string[];
  /** Default image width in px (canvas). Omit to use the default (720). */
  width?: number;
  /** Default image height in px (canvas). Omit to use the default (480). */
  height?: number;
}

/** RenderConfig with the fields the render module relies on always present. */
export interface ResolvedRenderConfig {
  fonts: ReadonlyArray<RenderFont>;
  stylesheets: string[];
  width: number;
  height: number;
}
