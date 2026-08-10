// Relative regression signal for what an RN app bundles when it imports the
// headless entry. Mirrors react-core's scripts/measure-copilotchat.mjs: drive
// esbuild over a synthetic entry, sum the gzipped output, print to the job
// summary. This is NOT a production Metro figure — it is comparable across PRs.
//
// Why this exists: a single import of @copilotkit/react-core/v2 (instead of
// /v2/headless) would multiply this number, because Metro does not tree-shake
// (issue #4893). The structural guards fail first; this makes the magnitude
// visible if one is ever weakened.
//
// Because the printed number is evidence for a bundle claim, this script is
// built to fail LOUDLY rather than print a flattering figure:
//   - the built entry is checked before esbuild runs, so an unbuilt package
//     produces a "run the build" message instead of a raw resolution stack;
//   - esbuild errors are re-thrown with context, and esbuild warnings are
//     formatted to stderr (`logLevel: "silent"` suppresses esbuild's own
//     printing — see the note on it below — so this script must print them);
//   - a zero or implausibly small total exits non-zero, because "0.0 kB" read
//     as a spectacular improvement is the worst way for this to break.
//
// Resolution note: the synthetic entry is fed via esbuild `stdin` with
// `resolveDir` set to this package's root (exactly as measure-copilotchat.mjs
// does), so `@copilotkit/react-native/headless` resolves through the workspace
// node_modules. Writing the entry to a temp dir would break resolution — the
// temp dir has no node_modules link to the monorepo.
//
// The symbols below are the lean headless API a custom-UI consumer imports.
// `useRenderToolCall` is included: RN's `src/headless.ts` re-exports it (from
// `@copilotkit/react-core/v2/headless`) as of the render-tool convergence, so
// it belongs in the measured surface a custom-UI consumer pulls in.
//
// `platform: "browser"` + `target: "es2022"` mirror measure-copilotchat.mjs.
// `platform: "neutral"` cannot resolve deps that ship only conditional
// `exports` (e.g. untruncate-json, chalk), and browser resolution is the
// closest esbuild analogue to how Metro resolves an RN app's JS graph.
//
// Run: `node scripts/measure-headless.mjs` (after
// `npx nx run @copilotkit/react-native:build`).
import { build, formatMessagesSync } from "esbuild";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

/** The public subpath whose import cost this script measures. */
export const HEADLESS_ENTRY = "@copilotkit/react-native/headless";

/** Built artifact `HEADLESS_ENTRY` resolves to; its absence means "not built". */
export const BUILT_ENTRY_FILE = "dist/headless.mjs";

/** Command that produces `BUILT_ENTRY_FILE`, named in every failure message. */
export const BUILD_COMMAND = "npx nx run @copilotkit/react-native:build";

/** The lean headless API a custom-UI consumer imports. */
export const HEADLESS_SYMBOLS = [
  "CopilotKitProvider",
  "useAgent",
  "useFrontendTool",
  "useRenderTool",
  "useRenderToolCall",
  "useComponent",
];

// Host-app-provided packages, excluded from the measurement for the same reason
// measure-copilotchat.mjs excludes react/react-dom: a consumer already ships
// them, so bundling them here would measure THEIR cost, not ours.
//
//   react         — peer dependency; the RN app provides it.
//   react-native  — peer dependency; the RN app (and its Metro graph) provides it.
//   react-dom     — NOT reachable from this entry today (verified: 0 of the 653
//                   input modules are react-dom). Listed defensively, for parity
//                   with measure-copilotchat.mjs: a stray web-oriented edge into
//                   react-dom/client or react-dom/server would otherwise silently
//                   add ~56 kB gzip to this figure — a 60% inflation of a number
//                   that exists as evidence for a bundle claim. Adding it does
//                   not move the figure (92.7 kB before and after).
//
// Subpaths need no entries of their own: esbuild prefix-matches package paths, so
// `react` also externalizes `react/jsx-runtime` and `react-dom` also externalizes
// `react-dom/client` and `react-dom/server` (esbuild CHANGELOG 0.5.14 / 0.14.13).
// `react/jsx-runtime` is kept explicit only because it documents that this entry's
// JSX transform is the host's; it is redundant under that prefix rule.
export const HEADLESS_EXTERNAL = [
  "react",
  "react-native",
  "react/jsx-runtime",
  "react-dom",
];

// Sanity FLOOR, not a budget. The headless graph pulls @ag-ui/client, core and
// react-core's headless entry; it measures ~92 kB gzip today and cannot
// plausibly drop an order of magnitude. A total below this means the
// graph was not really bundled (everything externalized, an empty/partial
// dist, a stubbed entry) — i.e. a broken measurement, not an improvement.
// Sits ~11x below the real figure so legitimate size work never trips it; if a
// real change ever approaches it, move the floor in the PR that explains why.
export const MIN_PLAUSIBLE_BYTES = 8 * 1024;

/**
 * Throw an actionable error if the package's built headless entry is missing.
 * Without this, esbuild dies with a raw `Could not resolve` stack that says
 * nothing about the actual cause (the package was never built).
 *
 * @param {string} pkgRoot - Absolute path to the package root.
 * @param {string} [entryFile] - Built file to require, relative to `pkgRoot`.
 */
export function assertBuilt(pkgRoot, entryFile = BUILT_ENTRY_FILE) {
  if (fs.existsSync(path.join(pkgRoot, entryFile))) return;
  throw new Error(
    `measure-headless: ${entryFile} is missing under ${pkgRoot}.\n` +
      `This script measures the BUILT headless entry, so build the package first:\n` +
      `  ${BUILD_COMMAND}`,
  );
}

/**
 * Explain why a measured total cannot be a real figure, or `null` if it can.
 *
 * @param {number} totalBytes - Summed gzip byte count.
 * @returns {string | null} Human-readable reason, or `null` when plausible.
 */
export function implausibleTotalReason(totalBytes) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return "esbuild produced no output (total is 0 bytes) — the measurement is broken, not improved";
  }
  if (totalBytes < MIN_PLAUSIBLE_BYTES) {
    return (
      `total is ${totalBytes} B gzip, below the ${MIN_PLAUSIBLE_BYTES} B plausibility floor — ` +
      `the headless graph was not really bundled (everything externalized, an empty or partial dist, ` +
      `or a stubbed entry). Treat this as a broken measurement, not an improvement.`
    );
  }
  return null;
}

/**
 * Bundle a synthetic entry that imports `symbols` from `entry` and return the
 * summed gzip byte count plus any esbuild warnings (the caller must surface
 * them — `logLevel: "silent"` means esbuild will not).
 *
 * @param {object} options
 * @param {string} options.pkgRoot - Resolution directory for the synthetic entry.
 * @param {string} [options.entry] - Module specifier to import from.
 * @param {string[]} [options.symbols] - Named exports to pull in and reference.
 * @param {string[]} [options.external] - Host-provided specifiers to exclude; defaults to `HEADLESS_EXTERNAL`.
 * @returns {Promise<{ totalBytes: number, outputCount: number, warnings: import("esbuild").Message[] }>}
 */
export async function measureHeadlessBundle({
  pkgRoot,
  entry = HEADLESS_ENTRY,
  symbols = HEADLESS_SYMBOLS,
  external = HEADLESS_EXTERNAL,
}) {
  const named = symbols.join(", ");
  const contents =
    `import { ${named} } from ${JSON.stringify(entry)};\n` +
    `console.log(${named});`;

  let result;
  try {
    result = await build({
      stdin: { contents, resolveDir: pkgRoot, loader: "js" },
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      write: false,
      minify: true,
      external,
      // Kept silent (as in measure-copilotchat.mjs) so stdout carries only the
      // one figure line that CI quotes. Silent discards esbuild's own printing,
      // NOT the diagnostics: warnings are returned on `result` and formatted by
      // the caller, and errors are formatted into the throw below.
      logLevel: "silent",
    });
  } catch (error) {
    throw new Error(
      `measure-headless: esbuild failed to bundle ${entry}.\n` +
        formatDiagnostics(error?.errors ?? [], "error") +
        formatDiagnostics(error?.warnings ?? [], "warning") +
        (hasUnresolvedEntry(error?.errors ?? [], entry)
          ? `\n${entry} did not resolve, which usually means the package is not built. Run:\n  ${BUILD_COMMAND}\n`
          : ""),
      { cause: error },
    );
  }

  const totalBytes = result.outputFiles.reduce(
    (sum, file) => sum + gzipSync(file.contents).length,
    0,
  );
  return {
    totalBytes,
    outputCount: result.outputFiles.length,
    warnings: result.warnings ?? [],
  };
}

/**
 * Format esbuild messages for a terminal, or `""` when there are none.
 *
 * @param {import("esbuild").Message[]} messages
 * @param {"error" | "warning"} kind
 */
function formatDiagnostics(messages, kind) {
  if (messages.length === 0) return "";
  return (
    formatMessagesSync(messages, { kind, color: false, terminalWidth: 100 })
      .join("")
      .trimEnd() + "\n"
  );
}

/** True if any esbuild error is an unresolved import of `entry`. */
function hasUnresolvedEntry(errors, entry) {
  return errors.some(
    (error) =>
      typeof error?.text === "string" &&
      error.text.includes("Could not resolve") &&
      error.text.includes(entry),
  );
}

// CLI entry — only runs when invoked directly, so importing this module from
// tests doesn't perform a real build at module-load time (as in
// react-core's measure-copilotchat.mjs).
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file://${path.resolve(process.argv[1] ?? "")}`;

if (isMain) {
  const pkgRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );

  try {
    assertBuilt(pkgRoot);

    const { totalBytes, warnings } = await measureHeadlessBundle({ pkgRoot });

    if (warnings.length > 0) {
      process.stderr.write(
        `measure-headless: esbuild reported ${warnings.length} warning(s) while bundling ${HEADLESS_ENTRY}:\n` +
          formatDiagnostics(warnings, "warning"),
      );
    }

    const reason = implausibleTotalReason(totalBytes);
    if (reason) {
      console.error(`measure-headless: ${reason}`);
      process.exit(1);
    }

    const kb = (totalBytes / 1024).toFixed(1);
    console.log(`${HEADLESS_ENTRY} (gzip, esbuild signal): ${kb} kB`);

    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### react-native headless import size\n\n\`${kb} kB\` gzipped (esbuild regression signal, not a Metro figure)\n`,
      );
    }
  } catch (error) {
    console.error(error?.message ?? error);
    process.exit(1);
  }
}
