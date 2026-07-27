import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { glob } from "glob";
import yaml from "yaml";
import {
  findUnexpectedMultiFileRegions,
  type MultiFileRegionSource,
} from "./lib/demo-region-guard.js";
import { checkEssentialContent } from "./lib/essential-content.js";
import type { PageInput } from "./lib/essential-content.js";

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

interface ManifestDemoLite {
  id: string;
  route?: string;
  highlight?: string[];
}

interface ManifestLite {
  slug: string;
  demos?: ManifestDemoLite[];
}

// Strip fenced code blocks (``` ... ```) before scanning for component
// references / links / imports. Without this, every regex below false-
// positives on example code inside tutorial pages — e.g. a docs page
// that shows `<InlineDemo demo="some-example" />` in a fenced code
// sample would report "unknown demo id" even though it's literal
// documentation, not a live component reference.
const FENCED_CODE_RE = /```[\s\S]*?```/g;
function strip(body: string): string {
  return body.replace(FENCED_CODE_RE, "");
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
    const body = strip(page.body);
    INLINE_DEMO_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_DEMO_RE.exec(body)) !== null) {
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

interface SetupContentLite {
  concepts: Record<string, { source?: string }>;
}

interface CodeBlock {
  language: string;
  meta: string;
  code: string;
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
    const body = strip(page.body);
    SNIPPET_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SNIPPET_RE.exec(body)) !== null) {
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

const REGION_START_RE = /@region\[([a-z0-9][a-z0-9-]*)\]/g;
const SKIP_EXACT = new Set([".DS_Store", "Thumbs.db"]);
const SKIP_DIRS = new Set(["__pycache__", "node_modules", ".next"]);
const SKIP_EXTENSIONS = new Set([
  ".pyc",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".avif",
  ".tiff",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".7z",
  ".rar",
  ".mp4",
  ".mp3",
  ".wav",
  ".mov",
  ".webm",
  ".ogg",
]);

function walkRegionCandidateFiles(
  absDir: string,
  currentRel = "",
): Array<{ abs: string; rel: string }> {
  const out: Array<{ abs: string; rel: string }> = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (SKIP_EXACT.has(entry.name)) continue;
    const abs = path.join(absDir, entry.name);
    const rel = currentRel ? `${currentRel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name))
        out.push(...walkRegionCandidateFiles(abs, rel));
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    out.push({ abs, rel });
  }
  return out;
}

function collectMultiFileRegionSources(): MultiFileRegionSource[] {
  const integrationsDir = path.join(REPO_ROOT, "showcase", "integrations");
  const sources: MultiFileRegionSource[] = [];
  const packageDirs = fs
    .readdirSync(integrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const pkgDir of packageDirs) {
    const pkgRoot = path.join(integrationsDir, pkgDir);
    const manifestPath = path.join(pkgRoot, "manifest.yaml");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = yaml.parse(
      fs.readFileSync(manifestPath, "utf-8"),
    ) as ManifestLite;
    for (const demo of manifest.demos ?? []) {
      if (!demo.route) continue;
      const routeDir = demo.route.replace(/^\/demos\//, "");
      const demoDir = path.join(pkgRoot, "src", "app", "demos", routeDir);
      if (!fs.existsSync(demoDir)) continue;

      const files = walkRegionCandidateFiles(demoDir).map((file) => ({
        ...file,
        bundled: `src/app/demos/${routeDir}/${file.rel}`,
      }));
      const demoPathSet = new Set(files.map((file) => file.bundled));
      for (const hlPath of demo.highlight ?? []) {
        if (demoPathSet.has(hlPath)) continue;
        const abs = path.join(pkgRoot, hlPath);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          files.push({ abs, rel: hlPath, bundled: hlPath });
        }
      }

      const filesByRegion = new Map<string, Set<string>>();
      for (const file of files) {
        const raw = fs.readFileSync(file.abs, "utf-8");
        REGION_START_RE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = REGION_START_RE.exec(raw)) !== null) {
          const regionFiles = filesByRegion.get(match[1]) ?? new Set<string>();
          regionFiles.add(file.bundled);
          filesByRegion.set(match[1], regionFiles);
        }
      }

      const demoKey = `${manifest.slug}::${demo.id}`;
      for (const [regionName, regionFiles] of filesByRegion.entries()) {
        if (regionFiles.size > 1) {
          sources.push({
            demoKey,
            regionName,
            files: [...regionFiles],
          });
        }
      }
    }
  }

  return sources;
}

export function checkUnexpectedMultiFileRegionSources(input: {
  sources: MultiFileRegionSource[];
}): CheckResult {
  const unexpected = findUnexpectedMultiFileRegions(input.sources);
  return {
    name: "duplicate-region-sources",
    status: unexpected.length === 0 ? "pass" : "fail",
    messages: unexpected.map(
      ({ demoKey, regionName, files }) =>
        `${demoKey}: region "${regionName}" appears in multiple files: ${files.join(", ")}`,
    ),
  };
}

export function checkDuplicateRegionSources(): CheckResult {
  return checkUnexpectedMultiFileRegionSources({
    sources: collectMultiFileRegionSources(),
  });
}

const MD_LINK_RE = /\[[^\]]*\]\((\/[^)\s]*)\)/g;

export function checkInternalLinks(input: {
  pages: PageInput[];
  knownRoutes: Set<string>;
}): CheckResult {
  const failures: string[] = [];
  for (const page of input.pages) {
    const body = strip(page.body);
    MD_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MD_LINK_RE.exec(body)) !== null) {
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
    const body = strip(page.body);
    ALIAS_IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ALIAS_IMPORT_RE.exec(body)) !== null) {
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

export function runEssentialContentCheck(pages: PageInput[]): CheckResult {
  const messages: string[] = [];
  for (const page of pages) {
    const r = checkEssentialContent(page);
    if (r.status === "fail") messages.push(...r.messages);
  }
  return {
    name: "essential-content",
    status: messages.length === 0 ? "pass" : "fail",
    messages,
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
    // Strip route-group segments like (other), (foo) — they are removed
    // from the URL by Fumadocs/Next.js. Mirrors normalizeSlugForUrl in
    // showcase/shell-docs/src/lib/sitemap-helpers.ts.
    const normalized = noIndex
      .split("/")
      .filter((seg) => !/^\(.+\)$/.test(seg))
      .join("/");
    routes.add(normalized === "" ? "/" : "/" + normalized);
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

export function loadSnippetComponentNames(): Set<string> {
  const docsRenderPath = path.join(
    REPO_ROOT,
    "showcase/shell-docs/src/lib/docs-render.tsx",
  );
  const src = fs.readFileSync(docsRenderPath, "utf-8");
  const mapMatch = src.match(/export const SNIPPET_MAP[^{]*\{([^}]+)\}/s);
  if (!mapMatch)
    throw new Error("Could not find SNIPPET_MAP in docs-render.tsx");
  const keys = [...mapMatch[1].matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]);
  return new Set(keys);
}

const SNIPPET_WITH_PROPS_RE = /<([A-Z]\w*)\s+[^>]*(?:>|\/>)/g;

// Matches the same shape that inlineSnippets() in docs-render.tsx resolves at
// render time. Per-match check (not per-name) so a page with both <Foo /> and
// <Foo framework="x" /> correctly flags only the latter.
const INLINE_HANDLED_RE = /^<[A-Z]\w*\s*(?:components=\{[^}]*\}\s*)?\/>/;

const MDX_IMPORT_NAME_RE = /^\s*import\s+(\w+)\s+from\s+["']@\/snippets\//gm;

export function checkComponentImports({
  pages,
}: {
  pages: PageInput[];
}): CheckResult {
  const snippetComponents = loadSnippetComponentNames();
  const failures: string[] = [];
  for (const page of pages) {
    const body = strip(page.body);

    // Scan imports on the stripped body (same as usages below). Using the raw
    // body would count an `import …` shown inside a fenced code sample as a
    // real import and silently suppress a genuine missing-import failure.
    const imported = new Set<string>();
    MDX_IMPORT_NAME_RE.lastIndex = 0;
    let im: RegExpExecArray | null;
    while ((im = MDX_IMPORT_NAME_RE.exec(body)) !== null) {
      imported.add(im[1]);
    }

    SNIPPET_WITH_PROPS_RE.lastIndex = 0;
    const flagged = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = SNIPPET_WITH_PROPS_RE.exec(body)) !== null) {
      const name = m[1];
      if (
        snippetComponents.has(name) &&
        !imported.has(name) &&
        !INLINE_HANDLED_RE.test(m[0]) &&
        !flagged.has(name)
      ) {
        flagged.add(name);
        failures.push(
          `${page.path}: <${name}> used with props but missing snippet import`,
        );
      }
    }
  }
  return {
    name: "component-imports",
    status: failures.length === 0 ? "pass" : "fail",
    messages: failures,
  };
}

const CLAUDE_QUICKSTARTS = [
  {
    slug: "claude-sdk-python",
    path: "integrations/claude-sdk-python/quickstart.mdx",
    title: "Python",
    modelEnvLine: "ANTHROPIC_MODEL=claude-sonnet-4-6",
    requiredStarterFiles: [
      "src/agent_server.py",
      "src/agents/claude_agent_sdk_adapter.py",
      "src/app/api/copilotkit/route.ts",
    ],
  },
  {
    slug: "claude-sdk-typescript",
    path: "integrations/claude-sdk-typescript/quickstart.mdx",
    title: "TypeScript",
    modelEnvLine: "CLAUDE_MODEL=claude-sonnet-4-6",
    requiredStarterFiles: [
      "src/agent_server.ts",
      "src/app/api/copilotkit/route.ts",
      "src/app/page.tsx",
    ],
  },
] as const;

const FENCE_RX = /^[ \t]*```([^\s`]*)?([^\n]*)\n([\s\S]*?)\n[ \t]*```/gm;

function extractCodeBlocks(body: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  FENCE_RX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RX.exec(body)) !== null) {
    blocks.push({
      language: match[1] ?? "",
      meta: match[2] ?? "",
      code: match[3],
    });
  }
  return blocks;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasFenceTitle(block: CodeBlock, title: string): boolean {
  return (
    new RegExp(`\\btitle=["']${escapeRegex(title)}["']`).test(block.meta) ||
    block.meta.trim() === `title=${title}`
  );
}

function findTitledBlock(
  blocks: CodeBlock[],
  title: string,
): CodeBlock | undefined {
  return blocks.find((block) => hasFenceTitle(block, title));
}

function findShellCommand(
  blocks: CodeBlock[],
  startsWith: string,
): string | undefined {
  return blocks
    .filter((block) => block.language === "bash" || block.language === "sh")
    .flatMap((block) => block.code.split(/\r?\n/).map((line) => line.trim()))
    .find((line) => line.startsWith(startsWith));
}

function addMissing(
  failures: string[],
  pagePath: string,
  body: string,
  needle: string,
  label: string,
) {
  if (!body.includes(needle)) {
    failures.push(`${pagePath}: missing ${label} (${needle})`);
  }
}

function addMissingRegex(
  failures: string[],
  pagePath: string,
  body: string,
  pattern: RegExp,
  label: string,
) {
  if (!pattern.test(body)) {
    failures.push(`${pagePath}: missing ${label}`);
  }
}

function checkBlockContains(
  failures: string[],
  pagePath: string,
  block: CodeBlock | undefined,
  title: string,
  needles: Array<[string | RegExp, string]>,
) {
  if (!block) {
    failures.push(`${pagePath}: missing code block title="${title}"`);
    return;
  }
  for (const [needle, label] of needles) {
    const ok =
      typeof needle === "string"
        ? block.code.includes(needle)
        : needle.test(block.code);
    if (!ok) failures.push(`${pagePath}: ${title} missing ${label}`);
  }
}

function checkCommandContains(
  failures: string[],
  pagePath: string,
  blocks: CodeBlock[],
  startsWith: string,
  label: string,
  packages: string[],
) {
  const command = findShellCommand(blocks, startsWith);
  if (!command) {
    failures.push(`${pagePath}: missing ${label} command (${startsWith})`);
    return;
  }

  for (const packageName of packages) {
    if (!command.includes(packageName)) {
      failures.push(
        `${pagePath}: ${label} command missing package ${packageName}`,
      );
    }
  }
}

export function checkClaudeQuickstarts(input: {
  pages: PageInput[];
  setupSource?: (framework: string, concept: string) => string | null;
  starterFileExists?: (framework: string, filePath: string) => boolean;
}): CheckResult {
  const failures: string[] = [];
  const pagesByPath = new Map(input.pages.map((page) => [page.path, page]));
  const setupSource = input.setupSource ?? (() => null);
  const starterFileExists = input.starterFileExists ?? (() => true);

  for (const config of CLAUDE_QUICKSTARTS) {
    const page = pagesByPath.get(config.path);
    if (!page) {
      failures.push(`${config.path}: quickstart page missing`);
      continue;
    }

    const blocks = extractCodeBlocks(page.body);
    addMissingRegex(
      failures,
      page.path,
      page.body,
      /<TailoredContent\b[^>]*\bid=["']agent["']/,
      'TailoredContent id="agent"',
    );
    addMissingRegex(
      failures,
      page.path,
      page.body,
      /<TailoredContentOption\b[^>]*\bid=["']starter["']/,
      "starter TailoredContentOption",
    );
    addMissingRegex(
      failures,
      page.path,
      page.body,
      /<TailoredContentOption\b[^>]*\bid=["']bring-your-own["']/,
      "bring-your-own TailoredContentOption",
    );
    addMissingRegex(
      failures,
      page.path,
      page.body,
      /<FrameworkSetup\b[^>]*\bconcept=["']agent-setup["']/,
      'FrameworkSetup concept="agent-setup"',
    );
    addMissing(
      failures,
      page.path,
      page.body,
      `npx copilotkit@latest init --framework ${config.slug}`,
      "starter CLI command",
    );
    addMissing(
      failures,
      page.path,
      page.body,
      "ANTHROPIC_API_KEY=your_anthropic_api_key",
      "Anthropic env var",
    );
    addMissing(
      failures,
      page.path,
      page.body,
      config.modelEnvLine,
      "Claude model env var",
    );
    addMissing(
      failures,
      page.path,
      page.body,
      "AGENT_URL=http://localhost:8000",
      "agent URL default",
    );
    addMissing(
      failures,
      page.path,
      page.body,
      "curl http://localhost:8000/health",
      "agent health check",
    );

    for (const filePath of config.requiredStarterFiles) {
      addMissing(
        failures,
        page.path,
        page.body,
        `\`${filePath}\``,
        `starter file claim ${filePath}`,
      );
      if (!starterFileExists(config.slug, filePath)) {
        failures.push(
          `${page.path}: documented starter file not found after extraction: ${filePath}`,
        );
      }
    }

    const setup = setupSource(config.slug, "agent-setup");
    if (!setup || setup.trim().length === 0) {
      failures.push(`${page.path}: missing bundled agent-setup content`);
    } else {
      if (!/ClaudeAgentAdapter/.test(setup)) {
        failures.push(`${page.path}: agent-setup missing ClaudeAgentAdapter`);
      }
      if (!/```|~~~/.test(setup)) {
        failures.push(`${page.path}: agent-setup missing a code block`);
      }
    }

    checkBlockContains(
      failures,
      page.path,
      findTitledBlock(blocks, "app/api/copilotkit/route.ts"),
      "app/api/copilotkit/route.ts",
      [
        ["HttpAgent", "HttpAgent"],
        ["CopilotRuntime", "CopilotRuntime"],
        ["ExperimentalEmptyAdapter", "ExperimentalEmptyAdapter"],
        [
          "copilotRuntimeNextJSAppRouterEndpoint",
          "copilotRuntimeNextJSAppRouterEndpoint",
        ],
        ['"http://localhost:8000"', "localhost agent URL"],
      ],
    );
    checkBlockContains(
      failures,
      page.path,
      findTitledBlock(blocks, "app/layout.tsx"),
      "app/layout.tsx",
      [
        ['@copilotkit/react-core/v2"', "v2 React entrypoint"],
        ['agent="claude_agent"', "agent prop"],
      ],
    );
    checkBlockContains(
      failures,
      page.path,
      findTitledBlock(blocks, "app/page.tsx"),
      "app/page.tsx",
      [["CopilotSidebar", "CopilotSidebar"]],
    );

    if (config.slug === "claude-sdk-python") {
      checkCommandContains(
        failures,
        page.path,
        blocks,
        "uv add ",
        "Python agent install",
        [
          "claude-agent-sdk",
          "ag-ui-claude-sdk",
          "ag-ui-protocol",
          "anthropic",
          "fastapi",
          "uvicorn",
          "python-dotenv",
        ],
      );
      checkCommandContains(
        failures,
        page.path,
        blocks,
        "npm install @copilotkit/runtime",
        "frontend install",
        ["@copilotkit/runtime", "@copilotkit/react-core", "@ag-ui/client"],
      );
      checkBlockContains(
        failures,
        page.path,
        findTitledBlock(blocks, "main.py"),
        "main.py",
        [
          ["RunAgentInput", "RunAgentInput"],
          ["await request.json()", "request JSON parsing"],
          ['os.getenv("ANTHROPIC_MODEL"', "Anthropic model env var"],
          ["RunErrorEvent", "RunErrorEvent"],
          ["EventType.RUN_ERROR", "RUN_ERROR event"],
          ["ClaudeAgentAdapter", "ClaudeAgentAdapter"],
          ["adapter.run(input_data)", "adapter run"],
          ["StreamingResponse", "StreamingResponse"],
          ['media_type="text/event-stream"', "SSE media type"],
          ['@app.get("/health")', "health route"],
          ['@app.post("/")', "agent POST route"],
        ],
      );
    } else {
      checkCommandContains(
        failures,
        page.path,
        blocks,
        "npm install @anthropic-ai/claude-agent-sdk",
        "TypeScript agent install",
        [
          "@anthropic-ai/claude-agent-sdk@^0.2.58",
          "@anthropic-ai/sdk",
          "@ag-ui/claude-agent-sdk",
          "@ag-ui/core",
          "@ag-ui/encoder",
          "express",
          "dotenv",
          "zod",
        ],
      );
      checkCommandContains(
        failures,
        page.path,
        blocks,
        "npm install -D typescript",
        "TypeScript dev install",
        ["typescript", "tsx", "@types/node", "@types/express"],
      );
      checkCommandContains(
        failures,
        page.path,
        blocks,
        "npm install @copilotkit/runtime",
        "frontend install",
        ["@copilotkit/runtime", "@copilotkit/react-core", "@ag-ui/client"],
      );
      const agentBlock = findTitledBlock(blocks, "src/agent-server.ts");
      checkBlockContains(
        failures,
        page.path,
        agentBlock,
        "src/agent-server.ts",
        [
          ["express", "express"],
          ["app.use(express.json", "JSON body parser"],
          ["RunAgentInput", "RunAgentInput"],
          ["EventType.RUN_ERROR", "RUN_ERROR event"],
          ["EventEncoder", "EventEncoder"],
          ["ClaudeAgentAdapter", "ClaudeAgentAdapter"],
          ['app.post("/",', "agent POST route"],
          ['app.get("/health"', "health route"],
          ['"text/event-stream"', "SSE content type"],
        ],
      );
      if (agentBlock) {
        const writesSse = /encodeSSE\s*\(/.test(agentBlock.code);
        const negotiatesContentType =
          /getContentType\s*\(\s*\)/.test(agentBlock.code) ||
          /new\s+EventEncoder\s*\(\s*\{[\s\S]*?\baccept\b[\s\S]*?\}\s*\)/.test(
            agentBlock.code,
          );
        if (writesSse && negotiatesContentType) {
          failures.push(
            `${page.path}: src/agent-server.ts writes SSE frames but negotiates a non-SSE content type`,
          );
        }
      }
    }
  }

  return {
    name: "claude-quickstarts",
    status: failures.length === 0 ? "pass" : "fail",
    messages: failures,
  };
}

function loadSetupContent(): SetupContentLite {
  const p = path.join(
    REPO_ROOT,
    "showcase",
    "shell-docs",
    "src",
    "data",
    "setup-content.json",
  );
  return JSON.parse(fs.readFileSync(p, "utf-8")) as SetupContentLite;
}

function createExtractedStarterResolver(): {
  starterFileExists: (framework: string, filePath: string) => boolean;
  cleanup: () => void;
  errors: string[];
} {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "claude-quickstarts-"));
  const cache = new Map<string, Set<string>>();
  const errors: string[] = [];

  function load(framework: string): Set<string> {
    const cached = cache.get(framework);
    if (cached) return cached;

    const outDir = path.join(tmpRoot, framework);
    const result = spawnSync(
      "npx",
      ["tsx", "extract-starter.ts", framework, outDir],
      {
        cwd: __dirname,
        encoding: "utf-8",
      },
    );
    if (result.status !== 0) {
      errors.push(
        `${framework}: starter extraction failed: ${[
          result.stdout,
          result.stderr,
        ]
          .filter(Boolean)
          .join("\n")}`,
      );
      const empty = new Set<string>();
      cache.set(framework, empty);
      return empty;
    }

    const files = glob
      .sync("**/*", { cwd: outDir, nodir: true, dot: true })
      .map((file) => file.split(path.sep).join("/"));
    const fileSet = new Set(files);
    cache.set(framework, fileSet);
    return fileSet;
  }

  return {
    starterFileExists: (framework, filePath) => load(framework).has(filePath),
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
    errors,
  };
}

async function main() {
  const skipBuild = process.argv.includes("--skip-build");
  const pages = loadPages();
  const registry = loadRegistry();
  const demoContent = loadDemoContent();
  const setupContent = loadSetupContent();
  const knownRoutes = loadKnownRoutes();
  const starterResolver = createExtractedStarterResolver();

  let failed = false;
  // Always clean up the extraction temp dir, even if a check throws — cleanup
  // runs in finally, and process.exit is deferred until after it so the exit
  // can't skip the finally block.
  try {
    const results: CheckResult[] = [
      runBuildCheck({ skipExecution: skipBuild }),
      checkInlineDemoRefs({ pages, registry }),
      checkSnippetRegions({ pages, demoContent }),
      checkDuplicateRegionSources(),
      checkInternalLinks({ pages, knownRoutes }),
      checkImportPaths({ pages, existsOnDisk: aliasExists }),
      checkComponentImports({ pages }),
      checkClaudeQuickstarts({
        pages,
        setupSource: (framework, concept) =>
          setupContent.concepts[`${framework}::${concept}`]?.source ?? null,
        starterFileExists: starterResolver.starterFileExists,
      }),
      runEssentialContentCheck(pages),
    ];
    if (starterResolver.errors.length > 0) {
      results.push({
        name: "starter-extraction",
        status: "fail",
        messages: starterResolver.errors,
      });
    }

    for (const r of results) {
      const tag =
        r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "SKIP";
      console.log(`[${tag}] ${r.name}`);
      for (const msg of r.messages) {
        console.log(`  ${msg}`);
      }
      if (r.status === "fail") failed = true;
    }
  } finally {
    starterResolver.cleanup();
  }

  process.exit(failed ? 1 : 0);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
