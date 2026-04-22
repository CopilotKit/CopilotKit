import { bundleIife, type IifeBundleResult } from "./shared/iife-bundler";

export type BundleResult = IifeBundleResult;

/**
 * Bundles a catalog component file into an IIFE string plus CSS.
 *
 * CSS is extracted from any CSS files imported by the component (via Rolldown).
 * Tailwind utility classes are handled by the @tailwindcss/browser CDN loaded
 * in the webview, which JIT-compiles classes directly from the DOM.
 *
 * React and @copilotkit/* are externalized and mapped to globals; everything
 * else (zod, etc.) is bundled into the IIFE.
 */
export function bundleCatalog(entryPath: string): Promise<BundleResult> {
  return bundleIife({
    entryPath,
    iifeName: "__copilotkit_catalog",
    external: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      /^@copilotkit\//,
    ],
    globals: {
      react: "__copilotkit_deps.React",
      "react-dom": "__copilotkit_deps.ReactDOM",
      "react-dom/client": "__copilotkit_deps.ReactDOMClient",
      "react/jsx-runtime": "__copilotkit_deps.JSXRuntime",
      "react/jsx-dev-runtime": "__copilotkit_deps.JSXRuntime",
      "@copilotkit/a2ui-renderer": "__copilotkit_deps.A2UIRenderer",
    },
  });
}
