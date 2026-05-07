#!/usr/bin/env node
/**
 * Install smoke test: prove that a consumer can install
 * `@copilotkit/runtime` without any `@langchain/*` peer installed and
 * still successfully `import` from the package root.
 *
 * The runtime advertises `@langchain/*` peers as optional in
 * `peerDependenciesMeta`. As of 1.58.0 the LangChain-coupled adapters
 * live in the `@copilotkit/runtime/langchain` subexport; the root barrel
 * has no `@langchain/*` references at module load time. This script
 * verifies that contract end-to-end, in a real Node module resolution.
 *
 * Steps:
 *   1. `pnpm pack` the runtime AND its workspace deps (`@copilotkit/shared`)
 *      into a tmp tarball directory. pnpm substitutes `workspace:*` to
 *      concrete versions so `npm install` can resolve the graph.
 *   2. Set up a fresh tmp project with no langchain installed.
 *   3. `npm install --omit=optional` the local tarballs. Optional peers
 *      (langchain, others) MUST NOT be auto-installed.
 *   4. Confirm no `@langchain/*` lives in `node_modules`.
 *   5. `node test-import.mjs` doing `await import("@copilotkit/runtime")`.
 *      Exit 0 only if the import succeeds with non-empty exports.
 *
 * Run via `pnpm nx run @copilotkit/runtime:test:smoke-no-langchain`.
 */
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.resolve(__dirname, "..");
const packagesDir = path.resolve(runtimeDir, "..");

// Workspace deps that aren't on npm at the version this branch will
// publish (yet). pnpm pack substitutes `workspace:*` to a concrete
// version; we pack each so npm can install them via local tarball.
const workspaceDepsToPack = ["shared"].map((name) =>
  path.resolve(packagesDir, name),
);

const tmpRoot = mkdtempSync(
  path.join(tmpdir(), "copilotkit-smoke-no-langchain-"),
);
const tarballsDir = path.join(tmpRoot, "tarballs");
const projectDir = path.join(tmpRoot, "project");
mkdirSync(tarballsDir, { recursive: true });
mkdirSync(projectDir, { recursive: true });

console.log(`smoke: tmp dir = ${tmpRoot}`);

function pack(srcDir, label) {
  console.log(`smoke: packing ${label}...`);
  execSync(`pnpm pack --pack-destination "${tarballsDir}"`, {
    cwd: srcDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

try {
  pack(runtimeDir, "@copilotkit/runtime");
  for (const depDir of workspaceDepsToPack) {
    pack(depDir, path.basename(depDir));
  }

  const tarballs = readdirSync(tarballsDir)
    .filter((f) => f.endsWith(".tgz"))
    .map((f) => path.join(tarballsDir, f));
  if (tarballs.length === 0) {
    throw new Error("smoke: no tarballs were produced");
  }
  console.log(`smoke: packed ${tarballs.length} tarball(s)`);

  writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify(
      { name: "copilotkit-smoke-no-langchain", private: true, type: "module" },
      null,
      2,
    ),
  );

  // --omit=optional ensures peer deps marked optional aren't auto-installed.
  // --no-audit and --no-fund keep the output focused on the test.
  const installArgs = [
    "install",
    "--no-audit",
    "--no-fund",
    "--omit=optional",
    ...tarballs.map((p) => `"${p}"`),
  ].join(" ");
  console.log(`smoke: npm ${installArgs}`);
  execSync(`npm ${installArgs}`, {
    cwd: projectDir,
    stdio: "inherit",
  });

  // Per the spec, the smoke test verifies that the runtime can be imported
  // when the consumer has not installed any `@langchain/*` package.
  // Concretely: there must not be any `@langchain/*` directory in the
  // installed `node_modules`. If there is, the runtime is dragging langchain
  // in transitively and the optional-peer claim is not yet true.
  const langchainDir = path.join(projectDir, "node_modules", "@langchain");
  if (existsSync(langchainDir)) {
    const installed = readdirSync(langchainDir);
    throw new Error(
      `@langchain/* installed despite no consumer request: ${installed.join(", ")}. ` +
        `The runtime is dragging langchain into the consumer's tree through a transitive dep. ` +
        `The optional-peer claim is not honest until that path is severed.`,
    );
  }
  console.log(`smoke: no @langchain/* in node_modules`);

  writeFileSync(
    path.join(projectDir, "test-import.mjs"),
    [
      `import * as runtime from "@copilotkit/runtime";`,
      `const keys = Object.keys(runtime);`,
      `if (keys.length === 0) {`,
      `  console.error("smoke: FAIL — no exports from @copilotkit/runtime");`,
      `  process.exit(1);`,
      `}`,
      `console.log("smoke: imported " + keys.length + " exports from @copilotkit/runtime");`,
      ``,
    ].join("\n"),
  );
  execSync(`node test-import.mjs`, {
    cwd: projectDir,
    stdio: "inherit",
  });

  console.log(
    `smoke: PASS — @copilotkit/runtime imports cleanly without @langchain/*`,
  );
} catch (err) {
  console.error(`smoke: FAIL — ${err.message ?? err}`);
  process.exitCode = 1;
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
