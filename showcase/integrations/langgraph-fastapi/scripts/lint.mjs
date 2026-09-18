import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = resolve(packageRoot, "../../..");
const config = resolve(repositoryRoot, ".oxlintrc.json");
const linter = resolve(repositoryRoot, "node_modules/oxlint/bin/oxlint");

if (!existsSync(config) || !existsSync(linter)) {
  throw new Error(
    "Package lint requires the repository config and locked root dependencies. Run pnpm install --frozen-lockfile at the repository root first.",
  );
}

const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: packageRoot,
  encoding: "utf8",
}).trim();
if (realpathSync(gitRoot) !== realpathSync(repositoryRoot)) {
  throw new Error("Package lint must run inside the CopilotKit repository.");
}

const extensions = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);
const files = execFileSync("git", ["ls-files", "-z", "--", "."], {
  cwd: packageRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter((file) => extensions.has(extname(file)));

if (files.length === 0) {
  throw new Error(
    "Package lint found no tracked JavaScript or TypeScript files.",
  );
}

console.log(
  `Checking ${files.length} tracked JavaScript and TypeScript files.`,
);
const result = spawnSync(
  process.execPath,
  [linter, "--config", config, "--no-ignore", ...files],
  { cwd: packageRoot, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.signal) {
  throw new Error(`Repository linter terminated with signal ${result.signal}.`);
}
process.exitCode = result.status ?? 1;
