import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { glob } from "glob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// showcase/scripts/ → showcase/ → repo root. Different from
// validate-parity.ts (which stops at showcase/) because `nx build shell-docs`
// must run from the monorepo root.
const REPO_ROOT = path.resolve(__dirname, "..", "..");

export type CheckStatus = "pass" | "fail" | "skipped";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  messages: string[];
}

export interface BuildCheckOptions {
  skipExecution?: boolean;
}

export function runBuildCheck(opts: BuildCheckOptions = {}): CheckResult {
  if (opts.skipExecution) {
    return {
      name: "nx-build-shell-docs",
      status: "skipped",
      messages: ["skipExecution=true; no build run"],
    };
  }
  const out = spawnSync("npx", ["nx", "build", "shell-docs"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  });
  if (out.status === 0) {
    return { name: "nx-build-shell-docs", status: "pass", messages: [] };
  }
  return {
    name: "nx-build-shell-docs",
    status: "fail",
    messages: [out.stdout || "", out.stderr || ""].filter(Boolean),
  };
}

interface RegistryDemo {
  id: string;
}
interface RegistryIntegrationLite {
  slug: string;
  demos: RegistryDemo[];
}
interface RegistryLite {
  integrations: RegistryIntegrationLite[];
}

interface PageInput {
  path: string;
  body: string;
}

const INLINE_DEMO_RE = /<InlineDemo\s+[^>]*demo=["']([^"']+)["']/g;

export function checkInlineDemoRefs(input: {
  pages: PageInput[];
  registry: RegistryLite;
}): CheckResult {
  const known = new Set<string>();
  for (const i of input.registry.integrations) {
    for (const d of i.demos) {
      known.add(d.id);
    }
  }

  const failures: string[] = [];
  for (const page of input.pages) {
    INLINE_DEMO_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_DEMO_RE.exec(page.body)) !== null) {
      if (!known.has(m[1])) {
        failures.push(`${page.path}: unknown demo id "${m[1]}"`);
      }
    }
  }

  return {
    name: "inline-demo-refs",
    status: failures.length === 0 ? "pass" : "fail",
    messages: failures,
  };
}

interface DemoRegion {
  file: string;
  startLine: number;
  endLine: number;
  code: string;
  language: string;
}

interface DemoFile {
  filename: string;
  language: string;
  content: string;
}

interface DemoRecord {
  regions?: Record<string, DemoRegion>;
  files?: DemoFile[];
}

interface DemoContent {
  demos: Record<string, DemoRecord>;
}

const SNIPPET_RE = /<Snippet\s+[^>]*region=["']([^"']+)["']/g;

export function checkSnippetRegions(input: {
  pages: PageInput[];
  demoContent: DemoContent;
}): CheckResult {
  const allRegions = new Set<string>();
  for (const record of Object.values(input.demoContent.demos)) {
    for (const regionName of Object.keys(record.regions ?? {})) {
      allRegions.add(regionName);
    }
  }

  const failures: string[] = [];
  for (const page of input.pages) {
    SNIPPET_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SNIPPET_RE.exec(page.body)) !== null) {
      if (!allRegions.has(m[1])) {
        failures.push(`${page.path}: unknown snippet region "${m[1]}"`);
      }
    }
  }

  return {
    name: "snippet-regions",
    status: failures.length === 0 ? "pass" : "fail",
    messages: failures,
  };
}

const MD_LINK_RE = /\[[^\]]*\]\((\/[^)\s]*)\)/g;

export function checkInternalLinks(input: {
  pages: PageInput[];
  knownRoutes: Set<string>;
}): CheckResult {
  const failures: string[] = [];
  for (const page of input.pages) {
    MD_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MD_LINK_RE.exec(page.body)) !== null) {
      const raw = m[1];
      const cleaned = raw.split("#")[0].split("?")[0];
      if (!input.knownRoutes.has(cleaned)) {
        failures.push(`${page.path}: dead link "${raw}"`);
      }
    }
  }
  return {
    name: "internal-links",
    status: failures.length === 0 ? "pass" : "fail",
    messages: failures,
  };
}

const ALIAS_IMPORT_RE =
  /^\s*import\s+[^"';]+from\s+["'](@\/[^"']+)["']\s*;?\s*$/gm;

export function checkImportPaths(input: {
  pages: PageInput[];
  existsOnDisk: (importPath: string) => boolean;
}): CheckResult {
  const failures: string[] = [];
  for (const page of input.pages) {
    ALIAS_IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ALIAS_IMPORT_RE.exec(page.body)) !== null) {
      if (!input.existsOnDisk(m[1])) {
        failures.push(`${page.path}: unresolved import "${m[1]}"`);
      }
    }
  }
  return {
    name: "import-paths",
    status: failures.length === 0 ? "pass" : "fail",
    messages: failures,
  };
}

function loadPages(): PageInput[] {
  const docsRoot = path.join(
    REPO_ROOT,
    "showcase",
    "shell-docs",
    "src",
    "content",
    "docs",
  );
  const files = glob.sync("**/*.mdx", { cwd: docsRoot });
  return files.map((rel) => ({
    path: rel,
    body: fs.readFileSync(path.join(docsRoot, rel), "utf-8"),
  }));
}

function loadRegistry(): RegistryLite {
  const p = path.join(
    REPO_ROOT,
    "showcase",
    "shell-docs",
    "src",
    "data",
    "registry.json",
  );
  return JSON.parse(fs.readFileSync(p, "utf-8")) as RegistryLite;
}

function loadDemoContent(): DemoContent {
  const p = path.join(
    REPO_ROOT,
    "showcase",
    "shell-docs",
    "src",
    "data",
    "demo-content.json",
  );
  return JSON.parse(fs.readFileSync(p, "utf-8")) as DemoContent;
}

function loadKnownRoutes(): Set<string> {
  const docsRoot = path.join(
    REPO_ROOT,
    "showcase",
    "shell-docs",
    "src",
    "content",
    "docs",
  );
  const files = glob.sync("**/*.mdx", { cwd: docsRoot });
  const routes = new Set<string>();
  for (const rel of files) {
    const noExt = rel.replace(/\.mdx$/, "");
    const noIndex = noExt.endsWith("/index")
      ? noExt.slice(0, -"/index".length)
      : noExt;
    routes.add("/" + noIndex);
  }
  routes.add("/"); // root
  return routes;
}

function aliasExists(importPath: string): boolean {
  const stripped = importPath.replace(/^@\//, "");
  const root = path.join(REPO_ROOT, "showcase", "shell-docs", "src");
  return (
    fs.existsSync(path.join(root, stripped)) ||
    fs.existsSync(path.join(root, "content", stripped))
  );
}

async function main() {
  const skipBuild = process.argv.includes("--skip-build");
  const pages = loadPages();
  const registry = loadRegistry();
  const demoContent = loadDemoContent();
  const knownRoutes = loadKnownRoutes();

  const results: CheckResult[] = [
    runBuildCheck({ skipExecution: skipBuild }),
    checkInlineDemoRefs({ pages, registry }),
    checkSnippetRegions({ pages, demoContent }),
    checkInternalLinks({ pages, knownRoutes }),
    checkImportPaths({ pages, existsOnDisk: aliasExists }),
  ];

  let failed = false;
  for (const r of results) {
    const tag = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "SKIP";
    console.log(`[${tag}] ${r.name}`);
    for (const msg of r.messages) {
      console.log(`  ${msg}`);
    }
    if (r.status === "fail") failed = true;
  }

  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
