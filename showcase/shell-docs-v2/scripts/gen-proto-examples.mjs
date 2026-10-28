// Builds src/proto/examples.json, the Examples catalog for prototype D, from
// the showcase: feature names and categories from shared/feature-registry.json,
// and which framework runs which demo from integrations/*/manifest.yaml.
// Run: node scripts/gen-proto-examples.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const showcase = join(import.meta.dirname, "..", "..");
const FRAMEWORKS = [
  "built-in-agent",
  "mastra",
  "langgraph-python",
  "langgraph-typescript",
  "crewai-crews",
  "pydantic-ai",
  "google-adk",
  "llamaindex",
  "agno",
  "ag2",
  "ms-agent-python",
  "strands",
  "strands-typescript",
  "claude-sdk-typescript",
  "claude-sdk-python",
  "langgraph-fastapi",
  "google-antigravity",
  "langroid",
  "ms-agent-dotnet",
  "ms-agent-harness-dotnet",
  "spring-ai",
];

const registry = JSON.parse(
  readFileSync(join(showcase, "shared/feature-registry.json"), "utf8"),
);
// feature id -> framework -> { route, files }
const runs = new Map();
const repos = {};
for (const fw of FRAMEWORKS) {
  const manifest = parse(
    readFileSync(join(showcase, "integrations", fw, "manifest.yaml"), "utf8"),
  );
  repos[fw] = manifest.repo;
  for (const demo of manifest.demos ?? []) {
    if (!demo.route) continue;
    if (!runs.has(demo.id)) runs.set(demo.id, {});
    runs.get(demo.id)[fw] = { route: demo.route, files: demo.highlight ?? [] };
  }
}

const features = registry.features
  .filter((f) => runs.has(f.id))
  .map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    category: f.category,
    frameworks: Object.keys(runs.get(f.id)),
    demos: runs.get(f.id),
  }));
const used = new Set(features.map((f) => f.category));
const out = {
  source:
    "showcase/shared/feature-registry.json + integrations/*/manifest.yaml",
  // Each framework's demos are served from its own deployment, which allows
  // framing; {slug} is the framework id (scripts/generate-registry.ts).
  host: "https://showcase-{slug}-production.up.railway.app",
  repos,
  categories: registry.categories.filter((c) => used.has(c.id)),
  features,
};
writeFileSync(
  join(import.meta.dirname, "..", "src/proto/examples.json"),
  JSON.stringify(out, null, 2) + "\n",
);
console.log(`${features.length} features, ${out.categories.length} categories`);
