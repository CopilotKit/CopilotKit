// Generates the showcase data the ported docs read (integration registry,
// catalog, demo source, per-framework setup content, Angular source) into
// src/data/, by running shell-docs' own generators from showcase/scripts,
// unchanged, and derives the examples playground's catalog from the registry.
//
// Those generators write next to themselves (showcase/shell*/src/data). So
// that this app never touches the other shells, each one is bundled with
// esbuild into a staging root under node_modules/.cache, where the showcase
// sources they read (integrations/, shared/, angular/, and this app's own
// src/content for the setup snippets) are symlinked in. Their outputs land in
// the staging root, and the ones this app reads are copied to src/data/.
//
//   npm run showcase-data        (also runs before `dev` and `build`)
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const showcase = join(app, "..");
const stage = join(app, "node_modules", ".cache", "showcase-data");
const out = join(app, "src", "data");

// The generators, in dependency order, and what each one reads, by its path
// under the showcase root.
const GENERATORS = [
  "generate-registry",
  "bundle-demo-content",
  "bundle-setup-content",
  "bundle-angular-source-content",
];
const LINKED = {
  integrations: join(showcase, "integrations"),
  shared: join(showcase, "shared"),
  angular: join(showcase, "angular"),
  "shell-docs/src/content": join(app, "src", "content"),
};
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
for (const [rel, source] of Object.entries(LINKED)) {
  const target = join(stage, rel);
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(source, target, "dir");
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

// Each integration's `docs_mode` alone, in registry order: small enough for
// the client, which reads which frameworks have docs from it
// (src/lib/live-scope.ts). A manifest without one is `generated`, as
// shell-docs' getDocsMode() read it.
const registry = JSON.parse(readFileSync(join(out, "registry.json"), "utf8"));
const docsModes = Object.fromEntries(
  registry.integrations.map((i) => [i.slug, i.docs_mode ?? "generated"]),
);
writeFileSync(
  join(out, "docs-modes.json"),
  `${JSON.stringify(docsModes, null, 2)}\n`,
);

// The examples playground's catalog (src/proto/examples.ts): each showcase
// feature with the demos that run it, by framework. A framework the registry
// hides, and a demo its manifest marks not supported, stay out. Only what
// the playground shows is kept, since it ships to the browser.
const demosByFeature = new Map();
const repos = {};
for (const int of registry.integrations) {
  if (int.docs_mode === "hidden") continue;
  repos[int.slug] = int.repo;
  const unsupported = new Set(int.not_supported_features ?? []);
  for (const demo of int.demos ?? []) {
    if (!demo.route || unsupported.has(demo.id)) continue;
    // "View the code" opens the first highlighted file that exists.
    const file = (demo.highlight ?? []).find((f) =>
      existsSync(join(showcase, "integrations", int.slug, f)),
    );
    if (!demosByFeature.has(demo.id)) demosByFeature.set(demo.id, {});
    demosByFeature.get(demo.id)[int.slug] = { route: demo.route, file };
  }
}
const features = registry.feature_registry.features
  .filter((f) => demosByFeature.has(f.id))
  .map((f) => ({
    id: f.id,
    name: f.name,
    category: f.category,
    demos: demosByFeature.get(f.id),
  }));
const used = new Set(features.map((f) => f.category));
writeFileSync(
  join(out, "examples.json"),
  JSON.stringify({
    repos,
    categories: registry.feature_registry.categories
      .filter((c) => used.has(c.id))
      .map((c) => ({ id: c.id, name: c.name })),
    features,
  }) + "\n",
);
console.log(`[showcase-data] ${OUTPUTS.length + 2} files -> src/data`);
