#!/usr/bin/env node
/**
 * Fails the build if `src/v2/context.ts` is inlined into any bundle other than
 * its own `dist/v2/context.*` entry (the self-contained UMD builds excepted).
 *
 * Why this needs a dedicated guard: a duplicated context module is invisible to
 * every other gate. `tsc`, vitest (which imports source, where there is only one
 * module), publint and attw all pass while the shipped package contains two
 * `createContext()` results. The only symptom is at runtime in a consumer app —
 * `CopilotKitProvider` publishes to the copy inlined in its own chunk, while
 * anything importing from `@copilotkit/react-core/v2/context` reads a second,
 * orphaned copy that nothing ever provides and so returns the defaults forever
 * (e.g. `useLicenseContext().status` pinned to `null` on a valid license).
 *
 * tsdown emits a `//#region <src path>` banner for each inlined module, so the
 * banner appearing outside the allow-list means the module got bundled twice.
 */
import fs from "fs";
import path from "path";

const MARKER = "//#region src/v2/context.ts";

// Bundles that are allowed to contain the module:
//   dist/v2/context.*  — the standalone entry itself
//   *.umd.js           — UMD is intentionally self-contained (single-file drop-in)
const ALLOWED = [/^v2\/context\.(mjs|cjs)$/, /\.umd\.js$/];

const distDir = path.resolve(process.argv[2] ?? "dist");

const jsFiles = [];
const walk = (current) => {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(mjs|cjs|js)$/.test(entry.name)) jsFiles.push(full);
  }
};

if (!fs.existsSync(distDir)) {
  console.error(`context-singleton-preflight: ${distDir} does not exist`);
  process.exit(1);
}
walk(distDir);

const carriers = jsFiles.filter((f) =>
  fs.readFileSync(f, "utf8").includes(MARKER),
);
const rel = (f) => path.relative(distDir, f).split(path.sep).join("/");

// Self-check: if the marker convention ever changes, this guard would silently
// pass on everything. Require the standalone entry to carry it.
if (!carriers.some((f) => /^v2\/context\.(mjs|cjs)$/.test(rel(f)))) {
  console.error(
    `context-singleton-preflight: marker ${MARKER} not found in dist/v2/context.*\n` +
      `The guard can no longer detect duplication — update MARKER to match the ` +
      `current bundler output before shipping.`,
  );
  process.exit(1);
}

const offenders = carriers
  .map(rel)
  .filter((f) => !ALLOWED.some((allowed) => allowed.test(f)));

if (offenders.length > 0) {
  console.error(
    `context-singleton-preflight: src/v2/context.ts is bundled into ${offenders.length} ` +
      `unexpected file(s):\n` +
      offenders.map((f) => `  - ${f}`).join("\n") +
      `\n\nThese ship a duplicate React context: whatever CopilotKitProvider ends up ` +
      `in will publish to a different instance than @copilotkit/react-core/v2/context ` +
      `exposes, so consumers of that subpath silently read stale defaults.\n` +
      `Fix: apply the \`externalizeContext\` plugin to that build in tsdown.config.ts.`,
  );
  process.exit(1);
}

console.log(
  `context-singleton-preflight: OK — src/v2/context.ts bundled only into ${carriers.length} allowed target(s).`,
);
