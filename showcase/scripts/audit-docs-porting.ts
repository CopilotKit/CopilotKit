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

async function main() {
  const v1Root = path.resolve(ROOT, "..", "docs", "content", "docs", "integrations");
  const shellDocsRoot = path.resolve(
    ROOT,
    "shell-docs",
    "src",
    "content",
    "docs",
    "integrations",
  );
  const outDir = path.join(__dirname, "audit-output");
  fs.mkdirSync(outDir, { recursive: true });

  const unready = listUnreadyFrameworks();
  const allComponents = new Set<string>();
  const allSnippetImports = new Set<string>();
  const summary: FrameworkDiff[] = [];

  for (const slug of unready) {
    const diff = diffFramework({ slug, v1Root, shellDocsRoot });
    summary.push(diff);

    const v1Dir = path.join(v1Root, slug);
    if (fs.existsSync(v1Dir)) {
      const v1Pages = glob.sync("**/*.mdx", { cwd: v1Dir });
      for (const rel of v1Pages) {
        try {
          const content = fs.readFileSync(path.join(v1Dir, rel), "utf-8");
          const refs = extractMdxReferences(content);
          refs.components.forEach((c) => allComponents.add(c));
          refs.snippetImports.forEach((s) => allSnippetImports.add(s));
        } catch (e) {
          console.warn(`Skipping ${slug}/${rel}: ${(e as Error).message}`);
        }
      }
    }

    fs.writeFileSync(
      path.join(outDir, `${slug}.json`),
      JSON.stringify(diff, null, 2),
    );
  }

  fs.writeFileSync(
    path.join(outDir, "_summary.json"),
    JSON.stringify(
      {
        unready,
        totals: {
          missing: summary.reduce((n, d) => n + d.missing.length, 0),
          divergent: summary.reduce((n, d) => n + d.divergent.length, 0),
        },
        components: [...allComponents].sort(),
        snippetImports: [...allSnippetImports].sort(),
      },
      null,
      2,
    ),
  );

  console.log(`Audit written to ${outDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
