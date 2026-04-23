import { bundleIife, type IifeBundleResult } from "../shared/iife-bundler";

export type HookBundleResult = IifeBundleResult;

/**
 * Bundles a user's source file (one that calls CopilotKit hooks) into an IIFE
 * that the hook-preview webview can execute.
 *
 * React is externalized as a singleton; `@copilotkit/react-core` (and its
 * `/v2` sub-path) are ALSO externalized and resolved at runtime to a
 * capture-only stub (see `webview/hook-preview/copilotkit-stubs.ts`). This
 * sidesteps the __commonJSMin TDZ chain that dragging the real library
 * through rolldown's IIFE output produces (require_clipboard, require_graphql,
 * require_context_helpers, …) — none of which are reachable on the preview
 * runtime path anyway, since we never drive a real chat/runtime.
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
      "@copilotkit/react-core",
      "@copilotkit/react-core/v2",
    ],
    globals: {
      react: "__copilotkit_deps.React",
      "react-dom": "__copilotkit_deps.ReactDOM",
      "react-dom/client": "__copilotkit_deps.ReactDOMClient",
      "react/jsx-runtime": "__copilotkit_deps.JSXRuntime",
      "react/jsx-dev-runtime": "__copilotkit_deps.JSXRuntime",
      "@copilotkit/react-core": "__copilotkit_deps.copilotkitStubs",
      "@copilotkit/react-core/v2": "__copilotkit_deps.copilotkitStubs",
    },
    skipSpecifierPrefixes: ["vscode"],
  });
}
