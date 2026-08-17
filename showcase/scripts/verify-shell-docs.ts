import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { glob } from "glob";
import yaml from "yaml";
// Imported from the bundler on purpose. These used to be hand-copied here with
// a "keep the two in sync" comment, which let the verifier's
// duplicate-region-sources check disagree with the bundler's hard error on the
// SAME tree: the gate passed and `nx build shell-docs` then failed.
// validate-parity.ts already imports `resolveDemoDir` for the same reason.
import {
  DEMO_PATH_PREFIX,
  SKIP_DIRS,
  SKIP_EXACT,
  SKIP_EXTENSIONS,
  UNIFIED_DEMOS_DIR,
  findRegionStartNames,
  resolveDemoDir,
} from "./bundle-demo-content.js";
import {
  describeDuplicateRegion,
  findUnexpectedDuplicateRegions,
} from "./lib/demo-region-guard.js";
import type { DuplicateRegionSource } from "./lib/demo-region-guard.js";
import { checkEssentialContent } from "./lib/essential-content.js";
import type { PageInput } from "./lib/essential-content.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// showcase/scripts/ → showcase/ → repo root. Different from
// validate-parity.ts (which stops at showcase/) because `nx build shell-docs`
// must run from the monorepo root.
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Windows resolves `npx` to `npx.cmd`, which `spawnSync` cannot exec
 * directly — it returns `{ error: ENOENT, status: null }`. Running through
 * the shell is the portable fix; every argument we pass is a hardcoded
 * literal, so there is no injection surface.
 */
const NEEDS_SHELL = process.platform === "win32";

/**
 * `glob` returns paths with the platform's native separator, so on Windows
 * every path it produces is `a\b\c`. Doc routes, bundled snippet paths and
 * `knownRoutes` keys are all POSIX, so a raw glob result silently misses
 * every multi-segment lookup. Normalise at every glob boundary.
 */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

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
    // `npx` is `npx.cmd` on Windows, so a bare spawnSync fails with ENOENT
    // (status === null) instead of running anything.
    shell: NEEDS_SHELL,
  });
  if (out.status === 0) {
    return { name: "nx-build-shell-docs", status: "pass", messages: [] };
  }
  return {
    name: "nx-build-shell-docs",
    status: "fail",
    // `out.error` carries spawn failures (ENOENT, EACCES, timeout). Without
    // it a spawn failure reported "the build failed" with an EMPTY message
    // array — a red gate with nothing to act on.
    messages: [
      out.error ? `spawn failed: ${out.error.message}` : "",
      out.status === null && !out.error
        ? `terminated without an exit status (signal ${String(out.signal)})`
        : "",
      out.stdout || "",
      out.stderr || "",
    ].filter(Boolean),
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

// Strip fenced code blocks before scanning for component references / links /
// imports. Without this, every regex below false-positives on example code
// inside tutorial pages — e.g. a docs page that shows
// `<InlineDemo demo="some-example" />` in a fenced code sample would report
// "unknown demo id" even though it's literal documentation, not a live
// component reference.
//
// BOTH fence flavours are stripped. Markdown accepts `~~~` as well as
// ```` ``` ````, and this file itself treats `~~~` as a valid fence elsewhere
// (see the agent-setup `/```|~~~/` check), so a triple-backtick-only strip
// reported the contents of every `~~~` example as unknown demo ids and
// unresolved imports — precisely the false positive the strip exists to
// prevent.
const FENCED_CODE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
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
  /**
   * 1-based inclusive last line — EXCEPT for an empty region, which the
   * bundler emits as `startLine - 1` (so `0` when the region opens on line 1).
   * Treat `endLine < startLine` as "empty span". See the `Region` interface in
   * bundle-demo-content.ts.
   */
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

const SNIPPET_RE = /<Snippet\s+[^>]*?region=["']([^"']+)["'][^>]*>/g;
/** `cell="<demo-id>"` on the same `<Snippet …>` tag, in either prop order. */
const SNIPPET_CELL_RE = /\bcell=["']([^"']+)["']/;

export function checkSnippetRegions(input: {
  pages: PageInput[];
  demoContent: DemoContent;
}): CheckResult {
  // Two indexes: the flat set of every region name (used when a <Snippet>
  // does not name a cell, because the demo is then resolved from page
  // context at render time), and a per-demo-id set. Checking a
  // cell-qualified <Snippet> against the FLAT set let a page reference the
  // wrong demo's region and still pass.
  const allRegions = new Set<string>();
  const regionsByDemoId = new Map<string, Set<string>>();
  for (const [demoKey, record] of Object.entries(input.demoContent.demos)) {
    // Bundle keys are "<integration-slug>::<demo-id>"; the demo id is what
    // a page's `cell=` prop names, and one shared demo serves every
    // integration, so union the region names across slugs.
    const demoId = demoKey.split("::").slice(1).join("::") || demoKey;
    const forDemo = regionsByDemoId.get(demoId) ?? new Set<string>();
    for (const regionName of Object.keys(record.regions ?? {})) {
      allRegions.add(regionName);
      forDemo.add(regionName);
    }
    regionsByDemoId.set(demoId, forDemo);
  }

  const failures: string[] = [];
  for (const page of input.pages) {
    const body = strip(page.body);
    SNIPPET_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SNIPPET_RE.exec(body)) !== null) {
      const regionName = m[1];
      const cell = SNIPPET_CELL_RE.exec(m[0])?.[1];
      if (cell === undefined) {
        if (!allRegions.has(regionName)) {
          failures.push(`${page.path}: unknown snippet region "${regionName}"`);
        }
        continue;
      }
      const forCell = regionsByDemoId.get(cell);
      if (!forCell) {
        failures.push(
          `${page.path}: <Snippet cell="${cell}"> names a demo that is not in the bundle`,
        );
      } else if (!forCell.has(regionName)) {
        failures.push(
          `${page.path}: unknown snippet region "${regionName}" for cell "${cell}"`,
        );
      }
    }
  }

  return {
    name: "snippet-regions",
    status: failures.length === 0 ? "pass" : "fail",
    messages: failures,
  };
}

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

/**
 * Which frontend root a resolved demo's `src/app/demos/…` highlight paths
 * address. The bundler's `resolveDemoDir` reports the ROOT it picked as
 * `origin`; this maps that back to the directory, so the preference order
 * (and its TEMPORARY integration fallback) stays owned by the bundler.
 */
function resolveDemoDirWithRoot(
  pkgRoot: string,
  routeDir: string,
): { dir: string; frontendDemosRoot: string } | null {
  const resolved = resolveDemoDir(pkgRoot, routeDir);
  if (!resolved) return null;
  return {
    dir: resolved.dir,
    frontendDemosRoot:
      resolved.origin === "unified"
        ? UNIFIED_DEMOS_DIR
        : path.join(pkgRoot, "src", "app", "demos"),
  };
}

function collectDuplicateRegionSources(): DuplicateRegionSource[] {
  const integrationsDir = path.join(REPO_ROOT, "showcase", "integrations");
  const sources: DuplicateRegionSource[] = [];
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
      const resolved = resolveDemoDirWithRoot(pkgRoot, routeDir);
      if (!resolved) continue;

      const files = walkRegionCandidateFiles(resolved.dir).map((file) => ({
        ...file,
        bundled: `${DEMO_PATH_PREFIX}${routeDir}/${file.rel}`,
      }));
      const demoPathSet = new Set(files.map((file) => file.bundled));
      for (const hlPath of demo.highlight ?? []) {
        if (demoPathSet.has(hlPath)) continue;
        // Frontend demo paths resolve against the frontend root; everything
        // else (backend agents, api routes) stays with the integration.
        const abs = hlPath.startsWith(DEMO_PATH_PREFIX)
          ? path.join(
              resolved.frontendDemosRoot,
              hlPath.slice(DEMO_PATH_PREFIX.length),
            )
          : path.join(pkgRoot, hlPath);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          files.push({ abs, rel: hlPath, bundled: hlPath });
        }
      }

      // Tally files AND total slices per region name. A distinct-file count
      // alone was blind to two `@region[x]` blocks in ONE file — the
      // copy-pasted-marker accident the bundler concatenates silently — so
      // the gate passed on trees the bundler rejects. Mirrors the bundler's
      // own tally in bundle-demo-content.ts.
      const byRegion = new Map<
        string,
        { files: Set<string>; sliceCount: number }
      >();
      for (const file of files) {
        const raw = fs.readFileSync(file.abs, "utf-8");
        for (const regionName of findRegionStartNames(raw)) {
          const entry = byRegion.get(regionName) ?? {
            files: new Set<string>(),
            sliceCount: 0,
          };
          entry.files.add(file.bundled);
          entry.sliceCount += 1;
          byRegion.set(regionName, entry);
        }
      }

      const demoKey = `${manifest.slug}::${demo.id}`;
      for (const [regionName, entry] of byRegion.entries()) {
        if (entry.sliceCount > 1) {
          sources.push({
            demoKey,
            demoId: demo.id,
            regionName,
            files: [...entry.files],
            sliceCount: entry.sliceCount,
          });
        }
      }
    }
  }

  return sources;
}

export function checkUnexpectedDuplicateRegionSources(input: {
  sources: DuplicateRegionSource[];
}): CheckResult {
  const unexpected = findUnexpectedDuplicateRegions(input.sources);
  return {
    name: "duplicate-region-sources",
    status: unexpected.length === 0 ? "pass" : "fail",
    // Worded by the shared helper so this gate and the bundler's hard error
    // describe the same finding identically.
    messages: unexpected.map(
      (source) =>
        `${source.demoKey}: region "${source.regionName}" ${describeDuplicateRegion(source)}`,
    ),
  };
}

export function checkDuplicateRegionSources(): CheckResult {
  return checkUnexpectedDuplicateRegionSources({
    sources: collectDuplicateRegionSources(),
  });
}

/**
 * Markdown inline link with a root-relative target.
 *
 * The `(?<!!)` lookbehind is load-bearing: markdown IMAGE syntax
 * `![alt](/images/x.png)` CONTAINS a link, so without the guard every static
 * asset gets validated against the doc-route table and reported as a dead
 * link.
 *
 * It MUST be a lookbehind, not the `(^|[^!])` character class this used to
 * be. A character class CONSUMES the character before `[`, so in two
 * BACK-TO-BACK links — `[a](/x)[b](/y)`, the shape of badge rows, nav rows
 * and table cells — the second link had no character left to match and was
 * never checked. A dead target in that position passed the gate silently.
 */
const MD_LINK_RE = /(?<!!)\[[^\]]*\]\((\/[^)\s]*)\)/g;

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
      // Accept a trailing slash: /foo/ and /foo are the same page.
      const normalized =
        cleaned.length > 1 ? cleaned.replace(/\/+$/, "") : cleaned;
      if (
        !input.knownRoutes.has(cleaned) &&
        !input.knownRoutes.has(normalized)
      ) {
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

const CONTENT_ROOT = path.join(
  REPO_ROOT,
  "showcase",
  "shell-docs",
  "src",
  "content",
);
const DOCS_ROOT = path.join(CONTENT_ROOT, "docs");

/** POSIX-relative `.mdx` paths under `root`. Empty when `root` is absent. */
function mdxFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return glob.sync("**/*.mdx", { cwd: root }).map(toPosix);
}

function loadPages(): PageInput[] {
  return mdxFiles(DOCS_ROOT).map((rel) => ({
    // POSIX so `page.path` matches the keys CLAUDE_QUICKSTARTS declares.
    // With native separators the quickstart lookup missed two pages that
    // exist on disk and reported them "missing".
    path: rel,
    body: fs.readFileSync(path.join(DOCS_ROOT, rel), "utf-8"),
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

/**
 * Content-relative slug for an `.mdx` file: extension dropped, a trailing
 * `/index` collapsed, and route-group segments like `(other)` removed
 * (Fumadocs/Next.js strip those from the URL). Mirrors normalizeSlugForUrl in
 * showcase/shell-docs/src/lib/sitemap-helpers.ts.
 */
function contentSlug(rel: string): string {
  const noExt = rel.replace(/\.mdx$/, "");
  const noIndex = noExt.endsWith("/index")
    ? noExt.slice(0, -"/index".length)
    : noExt;
  return noIndex
    .split("/")
    .filter((seg) => !/^\(.+\)$/.test(seg))
    .join("/");
}

/**
 * The framework whose docs are served at the ROOT surface. Its per-framework
 * override pages are addressable bare (`/server-tools`), and every
 * `/built-in-agent/*` URL permanently redirects to `/*`. Mirrors
 * ROOT_FRAMEWORK in showcase/shell-docs/src/lib/registry.ts.
 */
const ROOT_FRAMEWORK = "built-in-agent";

/** Channel frontends — mirrors CHANNEL_FRONTENDS in channel-guide-routes.ts. */
const CHANNEL_FRONTENDS = ["slack", "teams"] as const;

/**
 * Channel guide slugs that have no source file to derive them from:
 * `connect` is synthesised by getFrontendQuickstartNavTree, `overview` is the
 * public rename of `channels/index.mdx`, and `reference/channels` is a
 * cross-link into the reference surface. Every OTHER channel slug is derived
 * from `content/docs/channels/**` below (public slug = source slug minus the
 * `channels/` prefix), so this list stays two entries long as guides are
 * added.
 */
const SYNTHETIC_CHANNEL_SLUGS = ["connect", "overview", "reference/channels"];

/**
 * Reference SDK ids and the one served directly under `reference/`.
 * Mirrors REFERENCE_VERSIONS / ROOT_VERSION in
 * showcase/shell-docs/src/lib/reference-items.ts.
 */
const REFERENCE_VERSIONS = [
  "v2",
  "v1",
  "react-native",
  "vue",
  "angular",
  "core",
  "channels",
] as const;
const REFERENCE_ROOT_VERSION = "v2";

/**
 * Every route the docs app can serve.
 *
 * Enumerating ONLY the static `.mdx` files (what this used to do) made
 * `internal-links` a gate that could never go green: the app also serves a
 * large GENERATED surface — the per-framework route matrix, the
 * frontend-scoped surface, the channel guides, and the whole `/reference`
 * tree — and every link into it was reported dead. A check that is
 * permanently red carries no signal, so the generated surface is folded in
 * here rather than hidden behind an ignore list. Each rule below is derived
 * from files on disk, so new content is covered without editing this file.
 */
function loadKnownRoutes(registry: RegistryLite): Set<string> {
  const routes = new Set<string>(["/"]);

  // 1. Bare docs pages.
  const bareSlugs = new Set<string>();
  for (const rel of mdxFiles(DOCS_ROOT)) {
    const slug = contentSlug(rel);
    bareSlugs.add(slug);
    routes.add(slug === "" ? "/" : "/" + slug);
  }

  // 2. Per-framework route matrix. Every bare doc is also served scoped to a
  //    framework (`/<framework>/<slug>`), alongside the framework landing
  //    page and the per-framework override pages that live only under
  //    `content/docs/integrations/<folder>/`.
  //
  // `registry` is a PARAMETER, not a second `loadRegistry()` call: main()
  // already loads and parses registry.json for `checkInlineDemoRefs`, and
  // re-reading it here parsed the same file twice per run.
  const frontendIds = loadFrontendIds();
  // Frontend prefixes belong in the matrix too: a non-React frontend surface
  // falls back to the SHARED doc for any slug it does not author itself
  // (see resolveAngularDoc in shell-docs/src/lib/angular-doc-navigation.ts),
  // so `/angular/backend/copilot-runtime` resolves to the bare page.
  const frameworkPrefixes = new Set([
    ...registry.integrations.map((i) => i.slug),
    ...frontendIds,
  ]);
  const overrideSlugs = new Set<string>();
  const integrationsRoot = path.join(DOCS_ROOT, "integrations");
  if (fs.existsSync(integrationsRoot)) {
    const folders = fs
      .readdirSync(integrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const folder of folders) {
      // A docs FOLDER name is also a valid URL prefix: registry slugs and
      // folder names diverge (langgraph-python/-typescript/-fastapi all share
      // the `langgraph` folder, and links use the folder name).
      frameworkPrefixes.add(folder);
      for (const rel of mdxFiles(path.join(integrationsRoot, folder))) {
        overrideSlugs.add(contentSlug(rel));
      }
    }
    // ROOT_FRAMEWORK's override pages serve at BARE root URLs.
    for (const rel of mdxFiles(path.join(integrationsRoot, ROOT_FRAMEWORK))) {
      const slug = contentSlug(rel);
      routes.add(slug === "" ? "/" : "/" + slug);
    }
  }
  for (const prefix of frameworkPrefixes) {
    routes.add(`/${prefix}`);
    for (const slug of bareSlugs) if (slug) routes.add(`/${prefix}/${slug}`);
    for (const slug of overrideSlugs)
      if (slug) routes.add(`/${prefix}/${slug}`);
  }

  // 3. Frontend surface. `content/docs/frontends/<id>/**` canonicalizes to
  //    `/<id>/**`, plus the `/<id>/using-these-docs` guidance page.
  for (const frontend of frontendIds) {
    routes.add(`/${frontend}`);
    routes.add(`/${frontend}/using-these-docs`);
    const sourcePrefix = `frontends/${frontend}/`;
    for (const slug of bareSlugs) {
      if (slug.startsWith(sourcePrefix)) {
        routes.add(`/${frontend}/${slug.slice(sourcePrefix.length)}`);
      }
    }
  }

  // 4. Channel guides: `/<channel>/<slug>` with an optional framework
  //    segment for non-default backends (`/slack/<framework>/<slug>`).
  const channelSlugs = new Set<string>(SYNTHETIC_CHANNEL_SLUGS);
  for (const slug of bareSlugs) {
    if (slug.startsWith("channels/")) {
      channelSlugs.add(slug.slice("channels/".length));
    }
  }
  for (const channel of CHANNEL_FRONTENDS) {
    for (const slug of channelSlugs) {
      routes.add(`/${channel}/${slug}`);
      for (const framework of registry.integrations) {
        routes.add(`/${channel}/${framework.slug}/${slug}`);
      }
    }
  }

  // 5. Reference tree. `/reference/<sdk>/<item>` for every SDK, plus the
  //    unversioned `/reference/<item>` alias for the root SDK.
  routes.add("/reference");
  for (const version of REFERENCE_VERSIONS) routes.add(`/reference/${version}`);
  for (const rel of mdxFiles(path.join(CONTENT_ROOT, "reference"))) {
    const slug = contentSlug(rel);
    if (!slug) continue;
    const segments = slug.split("/");
    const declared = REFERENCE_VERSIONS.find((v) => v === segments[0]);
    const version = declared ?? REFERENCE_ROOT_VERSION;
    const item = declared ? segments.slice(1).join("/") : slug;
    routes.add(
      item ? `/reference/${version}/${item}` : `/reference/${version}`,
    );
    if (version === REFERENCE_ROOT_VERSION && item) {
      routes.add(`/reference/${item}`);
    }
  }

  // 6. AG-UI protocol docs.
  routes.add("/ag-ui");
  for (const rel of mdxFiles(path.join(CONTENT_ROOT, "ag-ui"))) {
    const slug = contentSlug(rel);
    routes.add(slug ? `/ag-ui/${slug}` : "/ag-ui");
  }

  return routes;
}

/** Frontend ids (react, vue, angular, slack, …) from the frontend registry. */
function loadFrontendIds(): string[] {
  const p = path.join(
    REPO_ROOT,
    "showcase",
    "shell-docs",
    "src",
    "data",
    "frontend-registry.json",
  );
  const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as {
    frontends: Array<{ id: string }>;
  };
  return parsed.frontends.map((f) => f.id);
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
  // Anchor on the ASSIGNMENT, then take the first `{` after it. Anchoring on
  // `SNIPPET_MAP[^{]*{` and then `indexOf("{", openIndex)` landed on whichever
  // `{` came first — so the moment the declaration gained a braced TYPE
  // (`: Record<string, { … }> =`, exactly the change the brace-matching
  // comment below anticipates) the walk started inside the type and the key
  // scan read the wrong body.
  const assignment = /export const SNIPPET_MAP\b[^=]*=/s.exec(src);
  if (!assignment)
    throw new Error("Could not find SNIPPET_MAP in docs-render.tsx");
  const braceStart = src.indexOf("{", assignment.index + assignment[0].length);
  if (braceStart === -1)
    throw new Error("SNIPPET_MAP in docs-render.tsx has no object literal");
  // Brace-match to the map's real closing brace. `[^}]+` stopped at the FIRST
  // `}` in the object literal, so the moment any SNIPPET_MAP value stopped
  // being a flat string the body was truncated and every later component name
  // silently vanished from the set — the check then failed OPEN (no
  // "missing snippet import" can be reported for a name it never saw).
  let depth = 0;
  let braceEnd = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        braceEnd = i;
        break;
      }
    }
  }
  if (braceEnd === -1)
    throw new Error("Unbalanced braces in SNIPPET_MAP in docs-render.tsx");
  const body = src.slice(braceStart + 1, braceEnd);
  const keys = [...body.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]);
  if (keys.length === 0)
    throw new Error("SNIPPET_MAP in docs-render.tsx has no entries");
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

/**
 * Fence languages that mark a shell transcript. `bash`/`sh` alone made the
 * quickstart checks report a MISSING command that was right there on the page,
 * just fenced as `shell` or `console` — both common in these docs and both
 * accepted by the highlighter.
 */
const SHELL_FENCE_LANGUAGES = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "console",
  "terminal",
]);

function findShellCommand(
  blocks: CodeBlock[],
  startsWith: string,
): string | undefined {
  return blocks
    .filter((block) =>
      SHELL_FENCE_LANGUAGES.has(block.language.trim().toLowerCase()),
    )
    .flatMap((block) =>
      block.code
        .split(/\r?\n/)
        // `console` / `terminal` transcripts prefix commands with a prompt
        // marker; drop it so the `startsWith` match still sees the command.
        .map((line) => line.trim().replace(/^[$>]\s+/, "")),
    )
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
        // See NEEDS_SHELL — `npx` is `npx.cmd` on Windows.
        shell: NEEDS_SHELL,
      },
    );
    if (result.status !== 0) {
      errors.push(
        `${framework}: starter extraction failed: ${[
          // Include `result.error` so a spawn failure (ENOENT, EACCES) is
          // diagnosable instead of an empty "extraction failed".
          result.error ? `spawn failed: ${result.error.message}` : "",
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
      .map(toPosix);
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
  const knownRoutes = loadKnownRoutes(registry);
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

  // Set `process.exitCode` and return rather than calling `process.exit`.
  // This report is hundreds of console.log lines and, when stdout is a pipe
  // (any CI capture), those writes are asynchronous — a synchronous
  // `process.exit` drops whatever is still buffered and truncates the report.
  // validate-parity.ts documents and follows the same convention.
  process.exitCode = failed ? 1 : 0;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
