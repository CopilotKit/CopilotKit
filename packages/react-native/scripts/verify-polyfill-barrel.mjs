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
//   - ESM is checked structurally: the CJS run already proves that each
//     polyfill installs its globals. Asserting the five imports survive the
//     bundler is the part this file exists to protect.
//
// Then a third check, over every published code entry in package.json
// `exports` (all but the polyfill subpaths): the built import and require
// files must load the polyfill barrel before anything else. An app can import
// any entry first, and @copilotkit/core and @ag-ui/client fail at load time on
// Hermes without the polyfills. It reads dist/ because the bundler decides the
// emitted order: it hoisted a shared provider chunk above the root entry's
// `export * from "./headless"`, so the source order alone proved nothing.
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
 * is read as text rather than executed (see the header note).
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

/**
 * Export subpaths that are the polyfills themselves, or carry no code. Every
 * other published entry loads @copilotkit/core or @ag-ui/client, which fail at
 * load time on Hermes without the polyfills, so each must install them first:
 * an app can import any entry before the root one.
 */
const isPolyfillOrManifestExport = (key) =>
  key === "./package.json" ||
  key === "./polyfills" ||
  key.startsWith("./polyfills/");

/** The first module an ESM file imports or re-exports, in order. */
export function firstEsmSpecifier(source) {
  const m =
    /^\s*(?:import\s*(?:[^;"'`]*?\bfrom\s*)?|export\s[^;"'`]*?\bfrom\s*)["'`]([^"'`]+)["'`]/m.exec(
      source.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/[^\n]*$/gm, ""),
    );
  return m ? m[1] : null;
}

/**
 * The first module a CJS file requires, in order, skipping the bundler's own
 * runtime helper chunk (rolldown's `chunk-*.cjs`: `__toESM` and friends, which
 * requires nothing and touches no global).
 */
export function firstCjsSpecifier(source) {
  for (const m of source.matchAll(/\brequire\s*\(\s*(["'])([^"']+)\1\s*\)/g)) {
    if (/(?:^|\/)chunk-[\w-]+\.cjs$/.test(m[2])) continue;
    return m[2];
  }
  return null;
}

/**
 * For every published code entry (from package.json `exports`), whether its
 * BUILT import and require targets load the polyfill barrel before anything
 * else. Checked in dist/, because the bundler decides the emitted order: a
 * shared chunk can be hoisted above a re-export that installs the polyfills.
 */
export function checkEntryOrder(packageDir) {
  const manifestPath = path.join(packageDir, "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`No package.json at ${manifestPath}.`);
  }
  const { exports: exportsMap } = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  );
  const results = [];
  for (const [key, value] of Object.entries(exportsMap ?? {})) {
    if (isPolyfillOrManifestExport(key)) continue;
    const targets =
      typeof value === "string" ? { import: value } : (value ?? {});
    for (const [condition, target] of Object.entries(targets)) {
      if (condition !== "import" && condition !== "require") continue;
      const file = path.join(packageDir, target);
      const cjs = file.endsWith(".cjs");
      let expected = path
        .relative(
          path.dirname(file),
          path.join(
            packageDir,
            "dist",
            cjs ? "polyfills.cjs" : "polyfills.mjs",
          ),
        )
        .split(path.sep)
        .join("/");
      if (!expected.startsWith(".")) expected = `./${expected}`;
      if (!existsSync(file)) {
        results.push({
          entry: key,
          file: target,
          expected,
          first: null,
          ok: false,
          error: "not built",
        });
        continue;
      }
      const source = readFileSync(file, "utf8");
      const first = cjs ? firstCjsSpecifier(source) : firstEsmSpecifier(source);
      results.push({
        entry: key,
        file: target,
        expected,
        first,
        ok: first === expected,
      });
    }
  }
  return results;
}

/** The barrel check plus the entry-order check, for a built package. */
export function verifyPackage(packageDir) {
  const barrel = verifyBarrel(path.join(packageDir, "dist"));
  const entries = checkEntryOrder(packageDir);
  return {
    ...barrel,
    entries,
    ok: barrel.ok && entries.every((entry) => entry.ok),
  };
}

export function formatReport({ cjs, esmMissing, entries = [] }) {
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
  for (const entry of entries) {
    lines.push(
      `${entry.ok ? "PASS" : "FAIL"}  ${entry.file.padEnd(32)} ` +
        `first loads ${entry.first ?? `(${entry.error ?? "nothing"})`}`,
    );
  }
  return lines.join("\n");
}

export function failureMessage({ cjs, esmMissing, entries = [] }) {
  const misordered = entries.filter((entry) => !entry.ok);
  if (
    misordered.length &&
    cjs.every((entry) => entry.missing.length === 0) &&
    esmMissing.length === 0
  ) {
    return (
      `A published entry does not install the polyfills before anything else.\n` +
      misordered
        .map(
          (entry) =>
            `  ${entry.file} (${entry.entry}) first loads ` +
            `${entry.first ?? `(${entry.error ?? "nothing"})`}, expected ${entry.expected}`,
        )
        .join("\n") +
      `\n\nAn app can import any entry before the root one, and on Hermes\n` +
      `@copilotkit/core and @ag-ui/client fail at load time without the polyfills.\n` +
      `Make \`import "./polyfills"\` (relative) the entry's first import, and list\n` +
      `the entry's src and dist paths in package.json "sideEffects".`
    );
  }
  return failureMessageForBarrel({ cjs, esmMissing }, misordered);
}

function failureMessageForBarrel({ cjs, esmMissing }, misordered) {
  const dropped = [
    ...cjs.flatMap((entry) => entry.missing),
    ...esmMissing.map((name) => `import "./polyfills/${name}.mjs"`),
  ];
  return (
    `The built polyfill barrel does not install everything it should.\n` +
    `Missing: ${dropped.join(", ")}\n\n` +
    `The side-effect imports in src/polyfills.ts were tree-shaken away. Check that\n` +
    `the "sideEffects" globs in package.json match this package's SOURCE paths —\n` +
    `globs that only match ./dist/** tell the bundler the src files are pure.` +
    (misordered.length
      ? `\n\nAlso misordered: ${misordered.map((entry) => entry.file).join(", ")}`
      : "")
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
    report = verifyPackage(packageRoot);
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
      process.stdout.write(
        `\nAll ${GROUPS.length} polyfill groups install, and all ` +
          `${report.entries.length} published entry files load them first.\n`,
      );
  }
  process.exit(report.ok ? 0 : 1);
}
