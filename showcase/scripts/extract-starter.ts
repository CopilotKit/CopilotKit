#!/usr/bin/env npx tsx
/**
 * Extract Starter
 *
 * Extracts a clean standalone starter from any integration directory.
 * Dereferences symlinks (tools/, shared-tools/) so the output is fully
 * self-contained. Strips test/QA/CI artifacts that end-users don't need.
 *
 * Usage:
 *   npx tsx showcase/scripts/extract-starter.ts <slug> [output-dir]
 *
 * Examples:
 *   npx tsx showcase/scripts/extract-starter.ts langgraph-python
 *   npx tsx showcase/scripts/extract-starter.ts mastra /tmp/mastra-starter
 */

import {
  cpSync,
  rmSync,
  existsSync,
  readdirSync,
  lstatSync,
  readlinkSync,
} from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SHOWCASE = resolve(__dirname, "..");
const slug = process.argv[2];
const outDir = process.argv[3] || join(SHOWCASE, "dist", "starters", slug);

if (!slug) {
  console.error("Usage: extract-starter.ts <slug> [output-dir]");
  process.exit(1);
}

const src = join(SHOWCASE, "integrations", slug);
if (!existsSync(src)) {
  console.error(`Integration not found: ${src}`);
  process.exit(1);
}

// Copy integration to output directory.
if (existsSync(outDir)) rmSync(outDir, { recursive: true });
cpSync(src, outDir, { recursive: true });

// Dereference symlinks: cpSync preserves symlinks even with
// dereference:true on some Node versions for directory symlinks.
// Manually replace any symlinks with real copies of their targets.
for (const entry of readdirSync(outDir)) {
  const entryPath = join(outDir, entry);
  if (lstatSync(entryPath).isSymbolicLink()) {
    const target = resolve(dirname(entryPath), readlinkSync(entryPath));
    rmSync(entryPath);
    if (existsSync(target)) {
      cpSync(target, entryPath, { recursive: true });
    }
  }
}

// Strip test/QA/CI artifacts that end-users don't need in a starter.
const STRIP = [
  "tests",
  "qa",
  "manifest.yaml",
  "PARITY_NOTES.md",
  "docs-links.json",
  "playwright.config.ts",
  "vitest.config.ts",
  "__tests__",
  "package-lock.json",
  "pnpm-lock.yaml",
];
for (const name of STRIP) {
  const target = join(outDir, name);
  if (existsSync(target)) rmSync(target, { recursive: true });
}

// Trim demo pages down to just the canonical sales-dashboard demo.
const demosDir = join(outDir, "src", "app", "demos");
if (existsSync(demosDir)) {
  for (const demo of readdirSync(demosDir)) {
    if (demo !== "sales-dashboard") {
      rmSync(join(demosDir, demo), { recursive: true });
    }
  }
}

// Trim API routes to just copilotkit and health endpoints.
const apiDir = join(outDir, "src", "app", "api");
if (existsSync(apiDir)) {
  for (const route of readdirSync(apiDir)) {
    if (route !== "copilotkit" && route !== "health") {
      rmSync(join(apiDir, route), { recursive: true });
    }
  }
}

console.log(`Extracted starter: ${outDir}`);
