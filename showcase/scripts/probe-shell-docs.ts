// Crawl every URL each visible framework's MDX tree should serve, fetch
// it from the dev server, and flag 404s + MDX/JS render errors.
//
// Why this exists (not just `nx build`): the build only catches static
// failures (unresolved imports, MDX parse errors). The dev server can
// 200-respond with a runtime error overlay or render a 404 page body
// while returning HTTP 200 (Next.js dev quirk), and `nx build` won't
// catch those. This crawl detects both.
//
// Usage:
//   PREVIEW_URL=http://localhost:3003 npx tsx probe-shell-docs.ts
//
// Concurrency is intentionally low (default 8) so the Next.js dev
// on-demand compiler doesn't thrash; bump via `CONCURRENCY=16` if the
// server is warm.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { glob } from "glob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_SCRIPTS = __dirname;
const CONTENT_DIR = path.resolve(
  REPO_SCRIPTS,
  "../shell-docs/src/content/docs",
);
const REGISTRY_PATH = path.resolve(
  REPO_SCRIPTS,
  "../shell-docs/src/data/registry.json",
);

const BASE = process.env.PREVIEW_URL ?? "http://localhost:3003";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);

// Mirror getDocsFolder from shell-docs/src/lib/registry.ts. Single source
// of truth lives there; duplicated here because this script is run via
// tsx in scripts/ which doesn't share the shell-docs tsconfig paths.
const DOCS_FOLDER_OVERRIDES: Record<string, string> = {
  "langgraph-python": "langgraph",
  "langgraph-typescript": "langgraph",
  "langgraph-fastapi": "langgraph",
  "google-adk": "adk",
  "crewai-crews": "crewai-flows",
  strands: "aws-strands",
  "ms-agent-dotnet": "microsoft-agent-framework",
  "ms-agent-python": "microsoft-agent-framework",
};
const getDocsFolder = (slug: string) => DOCS_FOLDER_OVERRIDES[slug] ?? slug;

// Mirror DOCS_ONLY_FRAMEWORK_MODES from shell-docs/src/lib/registry.ts.
// These slugs have no `showcase/integrations/<slug>/manifest.yaml` (so
// they never appear in `registry.integrations`) but DO have a
// `frameworkOverviews` entry that the route handler serves at
// `/<slug>`. The probe iterates `registry.integrations` for normal
// frameworks; without this fallback list it would silently skip
// every URL under these three slugs, including their framework root.
const DOCS_ONLY_FRAMEWORKS = ["a2a", "agent-spec", "deepagents"] as const;

interface Integration {
  slug: string;
  name: string;
  docs_mode?: "generated" | "authored" | "hidden";
}
interface Registry {
  integrations: Integration[];
}

function urlsForFramework(slug: string, docsFolder: string): string[] {
  const dir = path.join(CONTENT_DIR, "integrations", docsFolder);
  if (!fs.existsSync(dir)) {
    // No content folder at all — only the framework root URL is reachable
    // (Tier 1 data-driven; will render via FrameworkOverview record).
    return [`/${slug}`];
  }
  const files = glob.sync("**/*.mdx", { cwd: dir }).sort();
  const out = new Set<string>();
  for (const rel of files) {
    const noExt = rel.replace(/\.mdx$/, "");
    // index.mdx at root → bare /<slug>; a/b/index.mdx → /<slug>/a/b
    const cleaned =
      noExt === "index"
        ? ""
        : noExt.endsWith("/index")
          ? noExt.slice(0, -"/index".length)
          : noExt;
    out.add(cleaned ? `/${slug}/${cleaned}` : `/${slug}`);
  }
  return [...out];
}

interface ProbeResult {
  url: string;
  status: number;
  ok: boolean;
  reason: string;
  snippet?: string;
}

// Detect failures via STRUCTURAL signals only. Text matches in the body
// against runtime/MDX error strings sound attractive but consistently
// false-positive in dev mode because Next.js bundles the full source of
// helper functions (e.g. `MDXRemote`, the not-found component) into
// every page's serialized React tree — so "MDXRemote ... error" or
// "page could not be found" appear in every successful page's HTML.
//
// What's reliable:
//   • Real docs pages always render `<main>` chrome AND ≥1 `<h1>`
//     server-side via DocsPageView / FrameworkRootShell / MDXRemote.
//   • The 404 page renders client-side from a minimal SSR shell — no
//     `<main>`, no `<h1>` in the SSR HTML. So `!main && h1s == 0`
//     uniquely identifies a 404.
//   • A render error that crashes the page server-side returns a
//     non-200 status (caught upstream by `res.status !== 200`). A
//     soft runtime error renders an overlay on top of the page chrome
//     and is not reliably detectable from the body — those have to be
//     caught by visual inspection / browser console.
const H1_RX = /<h1[^>]*>([^<]+)<\/h1>/g;
const MAIN_RX = /<main[\s>]/;

async function probe(url: string): Promise<ProbeResult> {
  try {
    const res = await fetch(BASE + url, {
      redirect: "follow",
      headers: { "User-Agent": "probe-shell-docs" },
    });
    const body = await res.text();
    if (res.status !== 200) {
      return {
        url,
        status: res.status,
        ok: false,
        reason: `HTTP ${res.status}`,
      };
    }
    const h1s = [...body.matchAll(H1_RX)].map((m) => m[1]);
    const hasMain = MAIN_RX.test(body);
    // 404 page: client-rendered, no <main>, no <h1> in SSR HTML.
    if (!hasMain && h1s.length === 0) {
      return { url, status: 200, ok: false, reason: "404 page" };
    }
    // `<h1>404</h1>` slipped into the docs shell — rarer 404 variant.
    if (h1s.some((t) => /^\s*404\s*$/.test(t))) {
      return {
        url,
        status: 200,
        ok: false,
        reason: "404 in docs shell",
      };
    }
    return { url, status: 200, ok: true, reason: "OK" };
  } catch (e) {
    return {
      url,
      status: 0,
      ok: false,
      reason: `fetch failed: ${(e as Error).message}`,
    };
  }
}

async function main() {
  const registry = JSON.parse(
    fs.readFileSync(REGISTRY_PATH, "utf-8"),
  ) as Registry;
  const visible = registry.integrations.filter((i) => i.docs_mode !== "hidden");

  // Build URL set. Use a Set keyed by URL string so shared-folder
  // frameworks (langgraph variants share `langgraph/`, ms-agent dotnet
  // & python share `microsoft-agent-framework/`) don't probe the SAME
  // file twice under different slugs — each slug has its own URL
  // namespace, so we DO want to probe `/ms-agent-dotnet/quickstart`
  // AND `/ms-agent-python/quickstart`, but only once each.
  const urlsByFw = new Map<string, string[]>();
  let total = 0;
  // Probe every framework that has a `/<slug>` route. Registered
  // integrations get the full MDX-tree enumeration. Docs-only
  // frameworks (a2a / agent-spec / deepagents) are different: their
  // route handler in app/[framework]/[[...slug]]/page.tsx ONLY
  // serves the bare `/<slug>` root — scoped subpaths like
  // `/deepagents/quickstart` intentionally `notFound()` (see the
  // comment at "Docs-only frameworks ... only support the bare
  // `/<framework>` root URL"). Enumerating their MDX tree would
  // produce false-positive 404s, so we probe only the root for them.
  for (const i of visible) {
    const folder = getDocsFolder(i.slug);
    const urls = urlsForFramework(i.slug, folder);
    urlsByFw.set(i.slug, urls);
    total += urls.length;
  }
  for (const slug of DOCS_ONLY_FRAMEWORKS) {
    const rootOnly = [`/${slug}`];
    urlsByFw.set(slug, rootOnly);
    total += rootOnly.length;
  }
  const slugsToProbe = [...visible.map((i) => i.slug), ...DOCS_ONLY_FRAMEWORKS];
  // Also probe the unscoped docs root and a few canonical landings.
  const baseUrls = ["/", "/quickstart", "/concepts/architecture"];
  total += baseUrls.length;

  process.stdout.write(
    `Probing ${total} URLs across ${slugsToProbe.length} visible frameworks ` +
      `(concurrency ${CONCURRENCY}, base ${BASE})…\n`,
  );

  const allUrls = [...baseUrls, ...[...urlsByFw.values()].flat()];
  const results: ProbeResult[] = [];
  // Simple concurrency limiter: pull from a shared cursor.
  let idx = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < allUrls.length) {
      const my = idx++;
      const r = await probe(allUrls[my]);
      results.push(r);
      if (!r.ok) process.stdout.write("F");
      else process.stdout.write(".");
    }
  });
  await Promise.all(workers);
  process.stdout.write("\n\n");

  results.sort((a, b) => a.url.localeCompare(b.url));
  const failures = results.filter((r) => !r.ok);
  const okCount = results.length - failures.length;

  if (failures.length) {
    // Group failures by framework slug for readability.
    const byFw = new Map<string, ProbeResult[]>();
    for (const f of failures) {
      const fwSlug = f.url.split("/")[1] || "(root)";
      if (!byFw.has(fwSlug)) byFw.set(fwSlug, []);
      byFw.get(fwSlug)!.push(f);
    }
    console.log("=== Failures by framework ===");
    for (const [fw, items] of [...byFw.entries()].sort()) {
      console.log(
        `\n${fw}  (${items.length} failure${items.length === 1 ? "" : "s"})`,
      );
      for (const it of items) {
        const tail = it.snippet
          ? ` — “${it.snippet.replace(/\s+/g, " ").trim()}”`
          : "";
        console.log(`  ${it.reason.padEnd(14)}  ${it.url}${tail}`);
      }
    }
    console.log();
  }
  console.log(
    `Result: ${okCount}/${results.length} OK, ${failures.length} failed`,
  );
  if (failures.length) process.exit(1);
}

main();
