import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { glob } from "glob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export const READY_SLUGS = new Set([
  "langgraph-python",
  "langgraph-typescript",
  "google-adk",
]);

interface RegistryIntegration {
  slug: string;
  deployed: boolean;
}

interface Registry {
  integrations: RegistryIntegration[];
}

export function listUnreadyFrameworks(): string[] {
  const registryPath = path.join(
    ROOT,
    "shell-docs",
    "src",
    "data",
    "registry.json",
  );
  const registry = JSON.parse(
    fs.readFileSync(registryPath, "utf-8"),
  ) as Registry;
  return registry.integrations
    .filter((i) => i.deployed && !READY_SLUGS.has(i.slug))
    .map((i) => i.slug)
    .sort();
}

export interface FrameworkDiff {
  slug: string;
  missing: string[];
  divergent: string[];
}

export interface DiffOptions {
  slug: string;
  v1Root: string;
  shellDocsRoot: string;
}

export function diffFramework(opts: DiffOptions): FrameworkDiff {
  const v1Dir = path.join(opts.v1Root, opts.slug);
  const shellDir = path.join(opts.shellDocsRoot, opts.slug);
  if (!fs.existsSync(v1Dir)) {
    return { slug: opts.slug, missing: [], divergent: [] };
  }

  const v1Pages = glob.sync("**/*.mdx", { cwd: v1Dir }).sort();

  const missing: string[] = [];
  const divergent: string[] = [];

  for (const rel of v1Pages) {
    const v1Path = path.join(v1Dir, rel);
    const shellPath = path.join(shellDir, rel);
    if (!fs.existsSync(shellPath)) {
      missing.push(rel);
      continue;
    }
    const v1Content = fs.readFileSync(v1Path, "utf-8");
    const shellContent = fs.readFileSync(shellPath, "utf-8");
    if (v1Content !== shellContent) {
      divergent.push(rel);
    }
  }

  return { slug: opts.slug, missing, divergent };
}
