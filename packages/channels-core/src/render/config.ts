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
  /**
   * Gate for every remote URL the renderer fetches while rasterizing (`<img src>`,
   * CSS `url()`, emoji sheets). Return `false` to skip the fetch.
   *
   * Defaults to `defaultAllowImageUrl` (render/url-policy), which denies non-HTTP(S) schemes and
   * literally private/loopback/link-local hosts, including all IPv6 literals.
   * The renderer checks redirect targets with this predicate too, but the
   * synchronous check cannot resolve DNS. A public-looking name at any hop
   * may resolve to a private address, so use a trusted-origin allowlist when
   * JSX can carry untrusted URLs:
   *
   * ```ts
   * allowImageUrl: (url) => new URL(url).origin === "https://cdn.example.com"
   * ```
   *
   * Pass `() => false` to block all remote fetching, and enforce network egress
   * restrictions where the renderer runs.
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
