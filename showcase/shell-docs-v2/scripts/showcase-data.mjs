// Generates the showcase data the ported docs read (integration registry,
// catalog, demo source, per-framework setup content, Angular source) into
// src/data/, by running shell-docs' own generators from showcase/scripts,
// unchanged.
//
// Those generators write next to themselves (showcase/shell*/src/data). So
// that this app never touches the other shells, each one is bundled with
// esbuild into a staging root under node_modules/.cache, where the showcase
// sources they read (integrations/, shared/, angular/, shell-docs' setup
// snippets) are symlinked in. Their outputs land in the staging root, and the
// ones this app reads are copied to src/data/.
//
//   npm run showcase-data        (also runs before `dev` and `build`)
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const showcase = join(app, "..");
const stage = join(app, "node_modules", ".cache", "showcase-data");
const out = join(app, "src", "data");

// The generators, in dependency order, and what each one reads from the
// showcase root.
const GENERATORS = [
  "generate-registry",
  "bundle-demo-content",
  "bundle-setup-content",
  "bundle-angular-source-content",
];
const LINKED = ["integrations", "shared", "angular", "shell-docs/src/content"];
const OUTPUTS = [
  "registry.json",
  "catalog.json",
  "demo-content.json",
  "setup-content.json",
  "angular-source-content.json",
  // Per-frontend support and runnable cells (generate-registry): the Angular
  // feature catalog and the framework landings' live demos read them.
  "frontend-catalog.json",
  "frontend-registry.json",
];

rmSync(stage, { recursive: true, force: true });
for (const rel of LINKED) {
  const target = join(stage, rel);
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(join(showcase, rel), target, "dir");
}

for (const name of GENERATORS) {
  const bundled = join(stage, "scripts", `${name}.mjs`);
  await build({
    entryPoints: [join(showcase, "scripts", `${name}.ts`)],
    outfile: bundled,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    // showcase/ has no node_modules of its own; resolve its imports here.
    nodePaths: [join(app, "node_modules")],
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    logLevel: "warning",
  });
  // Run it through a symlink: generate-registry's own direct-run guard
  // compares real paths, so it still runs, while the validate-constraints
  // module bundled into it compares the literal path and stays a library.
  const entry = join(stage, "run", `${name}.mjs`);
  mkdirSync(dirname(entry), { recursive: true });
  symlinkSync(bundled, entry);
  execFileSync(process.execPath, [entry], {
    cwd: stage,
    env: { ...process.env, SHOWCASE_ROOT: stage },
    // The generators are chatty; keep their errors.
    stdio: ["ignore", "ignore", "inherit"],
  });
}

mkdirSync(out, { recursive: true });
for (const file of OUTPUTS) {
  const from = join(stage, "shell-docs", "src", "data", file);
  if (!existsSync(from)) {
    throw new Error(`[showcase-data] ${file} was not generated`);
  }
  copyFileSync(from, join(out, file));
}
console.log(`[showcase-data] ${OUTPUTS.length} files -> src/data`);
