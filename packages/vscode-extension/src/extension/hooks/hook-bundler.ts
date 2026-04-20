import { bundleIife, type IifeBundleResult } from "../shared/iife-bundler";

export type HookBundleResult = IifeBundleResult;

/**
 * Bundles a user's source file (one that calls CopilotKit hooks) into an IIFE
 * that the hook-preview webview can execute.
 *
 * Only React is externalized — it must be a singleton across the webview.
 * Everything else, including `@copilotkit/react-core` from the user's own
 * `node_modules`, is bundled in so the captured hook configs belong to the
 * exact CopilotKit version the user is developing against.
 */
export function bundleHookSite(entryPath: string): Promise<HookBundleResult> {
  return bundleIife({
    entryPath,
    iifeName: "__copilotkit_hookSite",
    external: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
    globals: {
      react: "__copilotkit_deps.React",
      "react-dom": "__copilotkit_deps.ReactDOM",
      "react-dom/client": "__copilotkit_deps.ReactDOMClient",
      "react/jsx-runtime": "__copilotkit_deps.JSXRuntime",
      "react/jsx-dev-runtime": "__copilotkit_deps.JSXRuntime",
    },
    // `node:` no longer needs to be in skipSpecifierPrefixes — the iife-bundler
    // now stubs Node builtins (prefixed or not) to empty/shim modules so the
    // IIFE doesn't externalize them as undefined args.
    skipSpecifierPrefixes: ["vscode"],
  });
}
