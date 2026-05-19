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
    const v1Content = fs.readFileSync(v1Path, "utf-8").replace(/\r\n/g, "\n");
    const shellContent = fs.readFileSync(shellPath, "utf-8").replace(/\r\n/g, "\n");
    if (v1Content !== shellContent) {
      divergent.push(rel);
    }
  }

  return { slug: opts.slug, missing, divergent };
}

export interface MdxReferences {
  components: string[];
  snippetImports: string[];
}

const JSX_TAG_RE = /<([A-Z][A-Za-z0-9]*)\b/g;
const IMPORT_RE =
  /^\s*import\s+[^"';]+from\s+["']([^"']+)["']\s*;?\s*$/gm;
const FENCED_CODE_RE = /```[\s\S]*?```/g;

export function extractMdxReferences(mdx: string): MdxReferences {
  // Strip fenced code blocks first so JSX in code samples doesn't get
  // counted as a real component reference.
  const stripped = mdx.replace(FENCED_CODE_RE, "");

  const components = new Set<string>();
  let m: RegExpExecArray | null;
  JSX_TAG_RE.lastIndex = 0;
  while ((m = JSX_TAG_RE.exec(stripped)) !== null) {
    components.add(m[1]);
  }

  const snippetImports = new Set<string>();
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(stripped)) !== null) {
    snippetImports.add(m[1]);
  }

  return {
    components: [...components].sort(),
    snippetImports: [...snippetImports],
  };
}
