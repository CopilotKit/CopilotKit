import { bundleIife, type IifeBundleResult } from "../shared/iife-bundler";
import {
  compileTailwindForBundle,
  type TailwindCompileResult,
} from "./tailwind-compile";

export interface PlaygroundBundleResult extends IifeBundleResult {
  /**
   * Diagnostic info about the Tailwind compile pass (if it ran). Surfaced
   * to the Diagnostics panel so the user can tell whether the playground
   * picked up their utility classes — and if not, why.
   */
  tailwind?: {
    entryCss?: string;
    skipped?: string;
    error?: string;
  };
}

export interface BundlePlaygroundOptions {
  /** User project root, used to locate their globals.css and Tailwind deps. */
  workspaceRoot?: string | null;
  /** Explicit override of the Tailwind entry CSS file. */
  tailwindEntryCss?: string;
  /** Output channel sink — same one runtime-host writes to. */
  log?: (line: string) => void;
}

/**
 * Bundles the codegen-produced entry.tsx for the chat tab. Compiles Tailwind
 * v4 against the bundled output so per-app utility classes (`rounded-2xl`,
 * `bg-gradient-to-br`, …) actually have CSS rules to match. Without this,
 * user-registered tool renders show up unstyled — see the comment in
 * tailwind-compile.ts for the full rationale.
 */
export async function bundlePlayground(
  entryPath: string,
  options: BundlePlaygroundOptions = {},
): Promise<PlaygroundBundleResult> {
  const result = await bundleIife({
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

  if (!result.success || !result.code || !options.workspaceRoot) {
    return result;
  }

  const log = options.log ?? (() => {});
  let tailwind: TailwindCompileResult;
  try {
    tailwind = await compileTailwindForBundle({
      workspaceRoot: options.workspaceRoot,
      bundledJs: result.code,
      entryCssOverride: options.tailwindEntryCss,
      log,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`[playground-tailwind] unexpected error: ${message}`);
    return { ...result, tailwind: { error: message } };
  }

  // Append Tailwind output to the existing CSS chunks (which already include
  // the v2 chat package's CSS plus anything imported by the user's tsx via
  // `import "./foo.css"`). Tailwind goes last so per-app utilities win the
  // cascade against any base styles that came earlier.
  const combinedCss = tailwind.css
    ? [result.css, tailwind.css].filter(Boolean).join("\n\n")
    : result.css;

  return {
    ...result,
    css: combinedCss,
    tailwind: {
      entryCss: tailwind.entryCss,
      skipped: tailwind.skipped,
      error: tailwind.error,
    },
  };
}
