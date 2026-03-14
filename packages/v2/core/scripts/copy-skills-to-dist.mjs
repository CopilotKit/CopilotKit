#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "../../..");
const skillsSourceDir = path.join(repoRoot, "skills");
const generatorScript = path.join(repoRoot, "docs", "scripts", "generate-skills.mjs");
const distSkillsDir = path.join(packageRoot, "dist", "skills");
const pkgSkillsDir = path.join(packageRoot, "skills");

function hasSkillsContent(skillsDir) {
  if (!fs.existsSync(skillsDir)) {
    return false;
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  return entries.some((entry) => entry.isDirectory() || entry.isFile());
}

if (!hasSkillsContent(skillsSourceDir)) {
  if (!fs.existsSync(generatorScript)) {
    throw new Error(
      `Skills source not found at ${skillsSourceDir}, and generator script is missing at ${generatorScript}`,
    );
  }

  console.log("Skills directory is missing or empty. Generating skills...");
  execFileSync("node", [generatorScript], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

if (!hasSkillsContent(skillsSourceDir)) {
  throw new Error(`Skills directory is still missing or empty: ${skillsSourceDir}`);
}

fs.rmSync(distSkillsDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(distSkillsDir), { recursive: true });
fs.cpSync(skillsSourceDir, distSkillsDir, { recursive: true });

// Also copy to package root skills/ for npx skills discovery
// (npx skills experimental_sync looks in node_modules/<pkg>/skills/*/SKILL.md)
fs.rmSync(pkgSkillsDir, { recursive: true, force: true });
fs.cpSync(skillsSourceDir, pkgSkillsDir, { recursive: true });

console.log(`Copied skills to dist: ${path.relative(packageRoot, distSkillsDir)}`);
console.log(`Copied skills to package root: ${path.relative(packageRoot, pkgSkillsDir)}`);
