import { build } from "rolldown";

export interface BundleResult {
  success: boolean;
  code?: string;
  error?: string;
}

/**
 * Bundles a catalog component file into an IIFE string that can be loaded
 * in the webview via a <script> tag.
 *
 * React and @copilotkit/* are externalized and mapped to globals that the
 * webview exposes on `window`. Everything else (zod, etc.) is bundled in.
 * This ensures the catalog uses the same React instance as the webview
 * (required for hooks to work) while avoiding bare-specifier resolution
 * issues in the browser.
 */
export async function bundleCatalog(entryPath: string): Promise<BundleResult> {
  try {
    const result = await build({
      input: entryPath,
      write: false,
      output: {
        format: "iife",
        name: "__copilotkit_catalog",
        exports: "named",
        globals: {
          "react": "__copilotkit_deps.React",
          "react-dom": "__copilotkit_deps.ReactDOM",
          "react-dom/client": "__copilotkit_deps.ReactDOMClient",
          "react/jsx-runtime": "__copilotkit_deps.JSXRuntime",
          "react/jsx-dev-runtime": "__copilotkit_deps.JSXRuntime",
          "@copilotkit/a2ui-renderer": "__copilotkit_deps.A2UIRenderer",
        },
      },
      external: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        /^@copilotkit\//,
      ],
      logLevel: "silent",
    });

    const output = result.output[0];
    if (!output) {
      return { success: false, error: "No output generated" };
    }

    return { success: true, code: output.code };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
