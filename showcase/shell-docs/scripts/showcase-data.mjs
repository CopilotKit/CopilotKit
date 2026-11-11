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
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
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

// Each integration's registry category (`popular`, `agent-framework`, ...),
// for the stack picker's `docs.framework_selected` event (src/proto/pieces.tsx),
// which reports it as shell-docs' framework selector did.
const frameworkCategories = Object.fromEntries(
  registry.integrations.map((i) => [i.slug, i.category]),
);
writeFileSync(
  join(out, "framework-categories.json"),
  `${JSON.stringify(frameworkCategories, null, 2)}\n`,
);

// Which shared pages read differently per framework (src/lib/live-docs.ts):
// a page that shows a framework's own showcase code, demo, or setup steps is
// a page of its own for that framework, indexed at /<framework>/<page>; a
// page that reads the same everywhere stays one page. `concepts` lists each
// page's setup concepts, which search indexes per framework.
const docsDir = join(app, "src", "content", "docs");
const demoContent = JSON.parse(
  readFileSync(join(out, "demo-content.json"), "utf8"),
).demos;
const setupConcepts = JSON.parse(
  readFileSync(join(out, "setup-content.json"), "utf8"),
).concepts;
const DOCS_ONLY_FRAMEWORKS = ["a2a", "agent-spec", "deepagents"];
const variantFrameworks = [
  ...registry.integrations.filter(
    (i) => i.docs_mode !== "hidden" && i.slug !== "built-in-agent",
  ),
  ...DOCS_ONLY_FRAMEWORKS.map((slug) => ({ slug })),
];
const walkDocs = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walkDocs(path);
    return entry.name.endsWith(".mdx") ? [path] : [];
  });
const variants = {};
const pageConcepts = {};
for (const file of walkDocs(docsDir)) {
  const rel = relative(docsDir, file);
  if (/^(frontends|channels|integrations)\//.test(rel)) continue;
  const slug = rel
    .split("/")
    .filter((part) => !/^\(.+\)$/.test(part))
    .join("/")
    .replace(/\.mdx$/, "")
    .replace(/(^|\/)index$/, "");
  if (!slug) continue;
  const source = readFileSync(file, "utf8");
  const cell = source.match(/^snippet_cell:\s*(\S+)/m)?.[1];
  const snippets = [...source.matchAll(/<Snippet\b([^>]*)\/?>/g)]
    .map(([, attrs]) => ({
      region: attrs.match(/region="([^"]+)"/)?.[1],
      cell: attrs.match(/cell="([^"]+)"/)?.[1] ?? cell,
      pinned: /framework="/.test(attrs),
    }))
    .filter((s) => s.region && s.cell && !s.pinned);
  const concepts = [
    ...new Set(
      [...source.matchAll(/<FrameworkSetup\s+concept="([^"]+)"/g)].map(
        ([, concept]) => concept,
      ),
    ),
  ];
  const demo = cell && /<InlineDemo\b/.test(source);
  if (concepts.length) pageConcepts[slug] = concepts;
  if (!snippets.length && !concepts.length && !demo) continue;
  for (const fw of variantFrameworks) {
    if (cell && (fw.not_supported_features ?? []).includes(cell)) continue;
    const own =
      snippets.some(
        (s) => demoContent[`${fw.slug}::${s.cell}`]?.regions?.[s.region],
      ) ||
      concepts.some((c) => setupConcepts[`${fw.slug}::${c}`]) ||
      (demo && demoContent[`${fw.slug}::${cell}`]);
    if (own) (variants[fw.slug] ??= []).push(slug);
  }
}
writeFileSync(
  join(out, "framework-variants.json"),
  `${JSON.stringify({ variants, concepts: pageConcepts })}\n`,
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
console.log(`[showcase-data] ${OUTPUTS.length + 4} files -> src/data`);
