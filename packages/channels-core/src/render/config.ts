import type { RenderFont } from "@copilotkit/channels-ui";

/** Channel-wide image-render configuration (renderer, fonts, compiled CSS). */
export interface RenderConfig {
  /**
   * Rasterizes JSX to PNG bytes. Required to post JSX as an image: pass
   * `takumiRenderer` from `@copilotkit/channels/takumi` (needs the optional
   * peers `react` and `takumi-js`). Without it, image posts throw.
   */
  renderer?: (node: unknown, cfg: ResolvedRenderConfig) => Promise<Uint8Array>;
  /** Fonts registered for rendering (Takumi has no system fonts). Also accepts `googleFonts()` output. */
  fonts?: ReadonlyArray<RenderFont>;
  /** Compiled CSS strings (e.g. your Tailwind/global.css). Resolves class selectors, `var()`, oklch. */
  stylesheets?: string[];
  /** Default image width in px (canvas). Omit to use the default (720). */
  width?: number;
  /** Default image height in px (canvas). Omit to use the default (480). */
  height?: number;
  /**
   * Gate for every remote URL the renderer fetches while rasterizing (`<img src>`,
   * CSS `url()`, emoji sheets). Returning `false` blocks the fetch and fails the
   * snapshot instead of posting an incomplete image.
   *
   * Defaults to denying every remote fetch. Opt in only to origins you trust:
   *
   * ```ts
   * allowImageUrl: (url) => new URL(url).origin === "https://cdn.example.com"
   * ```
   *
   * The renderer checks redirect targets too. This synchronous callback does
   * not validate resolved IP addresses, so pair any opt-in policy with network
   * egress restrictions when rendering untrusted content.
   */
  allowImageUrl?: (url: string) => boolean;
}

/** RenderConfig with the fields the render module relies on always present. */
export interface ResolvedRenderConfig {
  fonts: ReadonlyArray<RenderFont>;
  stylesheets: string[];
  width: number;
  height: number;
  allowImageUrl: (url: string) => boolean;
}
