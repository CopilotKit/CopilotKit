#!/usr/bin/env node
/**
 * One-time aggregator: takes per-integration content from .ports/<slug>/ and
 * merges it into the canonical quickstart, integrations.config.ts, and the
 * integration directories under docs/.
 *
 * After running, .ports/ can be deleted (it's gitignored anyway).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const PORTS_DIR = path.join(ROOT, '.ports');
const DOCS_DIR = path.join(ROOT, 'docs');
const CONFIG_PATH = path.join(ROOT, 'integrations.config.ts');
const QUICKSTART_PATH = path.join(DOCS_DIR, 'quickstart.mdx');

if (!fs.existsSync(PORTS_DIR)) {
  console.error('No .ports/ directory found. Nothing to aggregate.');
  process.exit(0);
}

// 1. Read all port reports + variant content
const slugs = fs
  .readdirSync(PORTS_DIR)
  .filter((d) => {
    const p = path.join(PORTS_DIR, d);
    return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'report.json'));
  })
  .sort();

const SECTION_MARKERS = ['prerequisites', 'install', 'env', 'runtime'];

function parseSections(content) {
  const sections = {};
  for (let i = 0; i < SECTION_MARKERS.length; i++) {
    const start = `{/* @SECTION:${SECTION_MARKERS[i]} */}`;
    const end =
      i < SECTION_MARKERS.length - 1 ? `{/* @SECTION:${SECTION_MARKERS[i + 1]} */}` : null;
    const startIdx = content.indexOf(start);
    if (startIdx < 0) {
      sections[SECTION_MARKERS[i]] = '';
      continue;
    }
    const contentStart = startIdx + start.length;
    const contentEnd = end ? content.indexOf(end, contentStart) : content.length;
    sections[SECTION_MARKERS[i]] = content.slice(contentStart, contentEnd).trim();
  }
  return sections;
}

const ports = slugs.map((slug) => {
  const portDir = path.join(PORTS_DIR, slug);
  const report = JSON.parse(fs.readFileSync(path.join(portDir, 'report.json'), 'utf-8'));
  const variantPath = path.join(portDir, 'quickstart-variant.mdx');
  const variantContent = fs.existsSync(variantPath)
    ? fs.readFileSync(variantPath, 'utf-8')
    : '';
  const sections = parseSections(variantContent);

  const pageFiles = fs
    .readdirSync(portDir)
    .filter((f) => f.endsWith('.mdx') && f !== 'quickstart-variant.mdx');

  return { ...report, sections, pageFiles };
});

console.log(`Aggregating ${ports.length} ports: ${ports.map((p) => p.slug).join(', ')}`);

// 2. Splice variant blocks into canonical quickstart
const SECTION_TO_HEADING = {
  prerequisites: '## Prerequisites',
  install: '## Install packages',
  env: '## Configure environment',
  runtime: '## Set up the runtime',
};

let qs = fs.readFileSync(QUICKSTART_PATH, 'utf-8');

for (const [section, heading] of Object.entries(SECTION_TO_HEADING)) {
  const headingIdx = qs.indexOf(heading);
  if (headingIdx < 0) {
    console.warn(`  ! heading not found: ${heading}`);
    continue;
  }
  // Find the start of the next `\n## ` heading after this one (end of section)
  const nextHeadingIdx = qs.indexOf('\n## ', headingIdx + heading.length);
  const sectionEnd = nextHeadingIdx > 0 ? nextHeadingIdx : qs.length;

  let newBlocks = '';
  for (const port of ports) {
    const sectionContent = port.sections[section];
    if (!sectionContent) continue;
    // Skip if a variant for this slug already exists in this section
    const existingMarker = `<Variant for="${port.slug}">`;
    const sectionSlice = qs.slice(headingIdx, sectionEnd);
    if (sectionSlice.includes(existingMarker)) continue;
    newBlocks += `\n\n<Variant for="${port.slug}">\n${sectionContent}\n</Variant>`;
  }

  if (newBlocks) {
    qs = qs.slice(0, sectionEnd) + newBlocks + '\n' + qs.slice(sectionEnd);
    console.log(`  + ${section}: spliced ${newBlocks.match(/<Variant for=/g)?.length ?? 0} blocks`);
  }
}

fs.writeFileSync(QUICKSTART_PATH, qs);

// 3. Move integration-only page files to docs/<slug>/
for (const port of ports) {
  if (port.pageFiles.length === 0) continue;
  const targetDir = path.join(DOCS_DIR, port.slug);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of port.pageFiles) {
    const src = path.join(PORTS_DIR, port.slug, file);
    const dst = path.join(targetDir, file);
    fs.copyFileSync(src, dst);
    console.log(`  → docs/${port.slug}/${file}`);
  }
}

// 4. Update integrations.config.ts
let cfg = fs.readFileSync(CONFIG_PATH, 'utf-8');

const integrationsRe =
  /(export const integrations = \[)([\s\S]*?)(\] as const satisfies readonly IntegrationDef\[\];)/;
const m = cfg.match(integrationsRe);
if (!m) throw new Error('Could not find integrations array in config');

let integrationsBody = m[2];
for (const port of ports) {
  if (integrationsBody.includes(`slug: '${port.slug}'`)) continue;
  integrationsBody =
    integrationsBody.replace(/\n\s*$/, '') +
    `\n  { slug: '${port.slug}', label: '${port.label}', color: '${port.color}' },\n`;
}

cfg = cfg.replace(integrationsRe, `$1${integrationsBody}$3`);

const ioRe =
  /(export const integrationOnlyPages = \{)([\s\S]*?)(\} as const satisfies Record<string, readonly PageDef\[\]>;)/;
const im = cfg.match(ioRe);
if (!im) throw new Error('Could not find integrationOnlyPages in config');

let ioBody = im[2];
for (const port of ports) {
  if (!port.integrationOnlyPages || port.integrationOnlyPages.length === 0) continue;
  // Skip if slug already has an entry (handles re-runs)
  const slugKey = port.slug.includes('-') ? `'${port.slug}'` : port.slug;
  const slugCheck = new RegExp(`\\b${slugKey.replace(/'/g, "'?")}:\\s*\\[`);
  if (slugCheck.test(ioBody)) continue;

  const pageEntries = port.integrationOnlyPages
    .map((p) => `    { slug: '${p.slug}', title: '${p.title}' },`)
    .join('\n');
  ioBody =
    ioBody.replace(/\n\s*$/, '') + `\n  ${slugKey}: [\n${pageEntries}\n  ],\n`;
}

cfg = cfg.replace(ioRe, `$1${ioBody}$3`);

fs.writeFileSync(CONFIG_PATH, cfg);
console.log(`✓ Updated integrations.config.ts (+${ports.length} integrations)`);

console.log('\nDone. Next:');
console.log('  npm run gen-routing && npx astro build');
console.log('  rm -rf .ports/  # cleanup staging');
