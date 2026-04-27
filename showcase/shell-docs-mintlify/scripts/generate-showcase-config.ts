/**
 * Generates src/lib/showcase.config.json from
 * showcase/packages/<slug>/{manifest.yaml, src/app/demos/}.
 *
 * Output shape: keyed by OUR integration slug (not the showcase package slug).
 * The showcase shell exposes each demo at `/demos/<feature>` — this generator
 * lists the demo directories present under `src/app/demos/` so the runtime
 * <ShowcaseDemo> component knows which features have a deployed demo.
 *
 *   {
 *     "<our-slug>": {
 *       "label": "Mastra",
 *       "backendUrl": "https://showcase-mastra-production.up.railway.app",
 *       "deployed": true,
 *       "features": ["agentic-chat", "hitl", "tool-rendering", ...]
 *     }
 *   }
 *
 * Code-tab content is NOT bundled here — see <ShowcaseCode> for the
 * build-time-fetch path that fetches and highlights raw GitHub source
 * separately from this metadata.
 *
 * Run via `npm run gen-showcase` (hooked into predev/prebuild).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { integrations } from '../integrations.config.ts';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(PROJECT_ROOT, '..');
const SHOWCASE_PACKAGES = path.join(REPO_ROOT, 'showcase', 'packages');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'src', 'lib', 'showcase.config.json');

function parseYaml(content: string): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (const line of content.split('\n')) {
    if (line.startsWith(' ') || line.startsWith('\t') || line.startsWith('-')) continue;
    const m = line.match(/^([a-z_][a-z0-9_]*):\s*(.*?)\s*$/i);
    if (!m) continue;
    let value: string | boolean = m[2];
    if (value === '') continue;
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (value.startsWith('>-') || value.startsWith('|')) continue;
    result[m[1]] = value;
  }
  return result;
}

function listDemos(packageDir: string): string[] {
  const demosDir = path.join(packageDir, 'src', 'app', 'demos');
  if (!fs.existsSync(demosDir)) return [];
  return fs
    .readdirSync(demosDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

interface ShowcaseEntry {
  label: string;
  backendUrl: string | null;
  deployed: boolean;
  features: string[];
}

const output: Record<string, ShowcaseEntry> = {};
const skipped: Array<{ slug: string; reason: string }> = [];

for (const integration of integrations) {
  if (!integration.showcaseSlug) {
    output[integration.slug] = {
      label: integration.label,
      backendUrl: null,
      deployed: false,
      features: [],
    };
    skipped.push({ slug: integration.slug, reason: 'no showcaseSlug in config' });
    continue;
  }
  const pkgDir = path.join(SHOWCASE_PACKAGES, integration.showcaseSlug);
  if (!fs.existsSync(pkgDir)) {
    output[integration.slug] = {
      label: integration.label,
      backendUrl: null,
      deployed: false,
      features: [],
    };
    skipped.push({ slug: integration.slug, reason: `package not found at ${pkgDir}` });
    continue;
  }

  const manifestPath = path.join(pkgDir, 'manifest.yaml');
  const manifest = fs.existsSync(manifestPath)
    ? parseYaml(fs.readFileSync(manifestPath, 'utf-8'))
    : {};
  const features = listDemos(pkgDir);

  output[integration.slug] = {
    label: integration.label,
    backendUrl: typeof manifest.backend_url === 'string' ? manifest.backend_url : null,
    deployed: manifest.deployed === true,
    features,
  };
}

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');

const totalFeatures = Object.values(output).reduce((sum, e) => sum + e.features.length, 0);
console.log(
  `✓ Wrote showcase.config.json — ${Object.keys(output).length} integration(s), ${totalFeatures} demos`,
);
if (skipped.length) {
  console.log(`  Skipped ${skipped.length}: ${skipped.map((s) => `${s.slug} (${s.reason})`).join(', ')}`);
}
