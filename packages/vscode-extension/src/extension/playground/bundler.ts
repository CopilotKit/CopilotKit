import { bundleIife, type IifeBundleResult } from "../shared/iife-bundler";

export type PlaygroundBundleResult = IifeBundleResult;

/**
 * Bundles the codegen-produced entry.tsx for the chat tab's Mounted Components
 * panel. Mirrors hook-bundler.ts's externals + globals: React is a singleton;
 * CopilotKit is resolved to the capture-only stub at runtime. Real runtime
 * integration is Plan #3.
 */
export function bundlePlayground(
  entryPath: string,
): Promise<PlaygroundBundleResult> {
  return bundleIife({
    entryPath,
    iifeName: "__copilotkit_playground",
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
