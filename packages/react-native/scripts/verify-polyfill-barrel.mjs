// Verifies that the BUILT polyfill barrel actually installs every polyfill.
//
// src/polyfills.ts is five side-effect-only imports plus installStreamingFetch().
// Side-effect-only imports are exactly what a bundler drops when it believes a
// module is pure, so the barrel can build down to a no-op while every source
// file and every source-level test stays green. That is not hypothetical:
// 1.69.2 shipped a 195-byte barrel that installed nothing but streaming fetch,
// and src/__tests__/polyfills.test.ts stayed green throughout because it
// imports "../polyfills" — the source, which is never bundled and so is never
// tree-shaken (OSS-1002).
//
// This therefore runs against dist/, not src/. Two checks, one per published
// format:
//
//   - CJS is executed for real, in a child realm stripped of the globals Hermes
//     lacks. Node ships ReadableStream, TextEncoder, crypto and DOMException
//     natively, so asserting they are merely "defined" afterwards would pass on
//     an empty barrel; clearing them first is what makes the check honest. It
//     runs in a child process so the probe cannot poison this one.
//   - ESM is checked structurally. It cannot be executed here: the encoding
//     polyfill takes a named import from `text-encoding`, which is CommonJS.
//     Metro rewrites that to a require() and it works in React Native; bare
//     Node ESM refuses it. Asserting the five imports survive the bundler is
//     the part this file exists to protect.
//
// Invoked from package.json `build`, so a barrel that installs nothing fails
// the build rather than reaching npm.
//
// Usage:
//   node scripts/verify-polyfill-barrel.mjs          # human readable, exits 1 on failure
//   node scripts/verify-polyfill-barrel.mjs --json   # machine readable report

import fs, { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

/**
 * Each group is one `import "./polyfills/<name>"` line in src/polyfills.ts,
 * paired with the globals that line exists to install.
 */
export const GROUPS = [
  {
    name: "streams",
    globals: ["ReadableStream", "WritableStream", "TransformStream"],
  },
  { name: "encoding", globals: ["TextEncoder", "TextDecoder"] },
  { name: "crypto", globals: ["crypto.getRandomValues"] },
  { name: "dom", globals: ["DOMException", "Headers"] },
  { name: "location", globals: ["window.location"] },
];

export const BUILD_COMMAND = "pnpm --filter @copilotkit/react-native build";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function assertBuilt(distDir) {
  for (const file of ["polyfills.cjs", "polyfills.mjs"]) {
    const artifact = path.join(distDir, file);
    if (!existsSync(artifact)) {
      throw new Error(
        `Built barrel not found at ${artifact}.\n` +
          `Run \`${BUILD_COMMAND}\` first — this check verifies build output, ` +
          `so an unbuilt package cannot be checked.`,
      );
    }
  }
}

/**
 * Which polyfill modules the ESM barrel no longer imports. Pure; the ESM barrel
 * is read as text rather than executed (see the header note on text-encoding).
 */
export function missingEsmImports(esmSource) {
  return GROUPS.filter(
    (group) => !esmSource.includes(`./polyfills/${group.name}.mjs`),
  ).map((group) => group.name);
}

/** The probe body run inside the stripped child realm. */
function probeSource(cjsBarrel) {
  return `
    const GROUPS = ${JSON.stringify(GROUPS)};
    // Emulate Hermes: none of these exist there.
    for (const group of GROUPS) {
      for (const dotted of group.globals) delete globalThis[dotted.split(".")[0]];
    }
    // React Native defines \`window\`; the location polyfill no-ops without it.
    globalThis.window = {};
    // Metro defines \`__DEV__\` in every React Native bundle. The streaming-fetch
    // feature detection reads it on its error path, so a bare realm without it
    // turns an ordinary fallback into a ReferenceError.
    globalThis.__DEV__ = false;
    // The crypto polyfill warns loudly by design. Keep the report readable.
    const realWarn = console.warn;
    console.warn = () => {};
    require(${JSON.stringify(cjsBarrel)});
    console.warn = realWarn;
    const read = (dotted) =>
      dotted.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), globalThis);
    process.stdout.write(JSON.stringify(GROUPS.map((group) => ({
      group: group.name,
      installed: group.globals.filter((g) => read(g) !== undefined),
      missing: group.globals.filter((g) => read(g) === undefined),
    }))));
  `;
}

/**
 * Executes the CJS barrel in a child realm stripped of the globals Hermes
 * lacks, and reports which groups installed.
 */
export function checkCjsBarrel(cjsBarrel) {
  const result = spawnSync(process.execPath, ["-e", probeSource(cjsBarrel)], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Could not execute the built CJS barrel ${cjsBarrel}:\n${result.stderr.trim()}`,
    );
  }
  return JSON.parse(result.stdout);
}

/** Runs both checks against a built dist directory. */
export function verifyBarrel(distDir) {
  assertBuilt(distDir);
  const cjs = checkCjsBarrel(path.join(distDir, "polyfills.cjs"));
  const esmMissing = missingEsmImports(
    readFileSync(path.join(distDir, "polyfills.mjs"), "utf8"),
  );
  const ok =
    cjs.every((entry) => entry.missing.length === 0) && esmMissing.length === 0;
  return { ok, cjs, esmMissing };
}

export function formatReport({ cjs, esmMissing }) {
  const lines = cjs.map(
    (entry) =>
      `${entry.missing.length === 0 ? "PASS" : "FAIL"}  cjs  ${entry.group.padEnd(9)} ` +
      `${entry.installed.join(", ") || "(nothing installed)"}`,
  );
  for (const group of GROUPS) {
    lines.push(
      `${esmMissing.includes(group.name) ? "FAIL" : "PASS"}  esm  ${group.name.padEnd(9)} ` +
        `import "./polyfills/${group.name}.mjs"`,
    );
  }
  return lines.join("\n");
}

export function failureMessage({ cjs, esmMissing }) {
  const dropped = [
    ...cjs.flatMap((entry) => entry.missing),
    ...esmMissing.map((name) => `import "./polyfills/${name}.mjs"`),
  ];
  return (
    `The built polyfill barrel does not install everything it should.\n` +
    `Missing: ${dropped.join(", ")}\n\n` +
    `The side-effect imports in src/polyfills.ts were tree-shaken away. Check that\n` +
    `the "sideEffects" globs in package.json match this package's SOURCE paths —\n` +
    `globs that only match ./dist/** tell the bundler the src files are pure.`
  );
}

function realPath(p) {
  const absolute = path.resolve(p);
  try {
    return fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

export function isEntrypoint(moduleUrl, argv1) {
  if (!argv1) return false;
  let modulePath;
  try {
    modulePath = fileURLToPath(moduleUrl);
  } catch {
    // Not a `file:` URL (e.g. `data:`), so it cannot be the CLI entry.
    return false;
  }
  // realpath both sides: on macOS os.tmpdir() is /var/... while import.meta.url
  // resolves through to /private/var/..., and a raw compare would never match.
  return realPath(modulePath) === realPath(argv1);
}

// CLI entry — only runs when invoked directly, so importing this module from
// tests doesn't run a check at module-load time (mirrors measure-headless.mjs).
if (isEntrypoint(import.meta.url, process.argv[1])) {
  const jsonMode = process.argv.includes("--json");
  let report;
  try {
    report = verifyBarrel(path.join(packageRoot, "dist"));
  } catch (error) {
    if (jsonMode) {
      process.stdout.write(
        JSON.stringify({ ok: false, error: error.message }) + "\n",
      );
    } else {
      process.stderr.write(`\n${error.message}\n`);
    }
    process.exit(1);
  }

  if (jsonMode) {
    process.stdout.write(JSON.stringify(report) + "\n");
  } else {
    process.stdout.write(formatReport(report) + "\n");
    if (!report.ok) process.stderr.write(`\n${failureMessage(report)}\n`);
    else
      process.stdout.write(`\nAll ${GROUPS.length} polyfill groups install.\n`);
  }
  process.exit(report.ok ? 0 : 1);
}
