// Docs-link probe.
//
// Reads shared/feature-registry.json; for each feature:
//   - og_docs_url    → HTTP HEAD. 2xx = "ok", else "notfound" / "error".
//   - shell_docs_path (relative path like "/docs/features/agentic-chat";
//                      falls back to legacy `shell_docs_url` if present)
//                    → check shell-docs/src/content/docs/<path>.mdx
//                      (or index.mdx). File exists = "ok", else "notfound".
//                      No network.
//
// `shell_docs_path` is the preferred key (matches the schema in
// `scripts/generate-registry.ts` + per-package `docs-links.json`). The legacy
// `shell_docs_url` alias is retained for backward compatibility with older
// `shared/feature-registry.json` snapshots; if only the legacy key is present
// we emit a one-shot notice in dev so the stale shape doesn't go unnoticed.
//
// Writes shell/src/data/docs-status.json. The shell-dashboard UI reads it
// so green ✓ / red ✗ reflect actual reachability, not just "field present."
//
// Intended to run on `pnpm dev` (via predev hook) and CI. Safe to run
// frequently — HEAD requests are cheap and the file list is ~50.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(ROOT, "shared", "feature-registry.json");
// MDX docs content now lives in shell-docs (it owns the docs hostname).
// docs-status.json is still consumed only by shell-dashboard, so it keeps
// emitting under shell/data for the dashboard to read. The CONTENT scan
// source is shell-docs — the "shell_docs_url" field points at paths that
// now serve from docs.showcase.copilotkit.ai.
const SHELL_DOCS_ROOT = path.join(ROOT, "shell-docs", "src", "content", "docs");
const OUTPUT_PATH = path.join(ROOT, "shell", "src", "data", "docs-status.json");

type DocState = "ok" | "missing" | "notfound" | "error";

interface Feature {
  id: string;
  og_docs_url?: string;
  shell_docs_path?: string;
  /** @deprecated use `shell_docs_path`; retained for backward compat */
  shell_docs_url?: string;
}

// One-shot dev-mode notice when a registry only carries the legacy
// `shell_docs_url` key. Guarded by NODE_ENV so CI (and prod builds) stay
// quiet; surfaces to devs running `pnpm dev` exactly once per process.
let legacyKeyNoticeEmitted = false;
function noteLegacyShellDocsKey(featureId: string): void {
  if (legacyKeyNoticeEmitted) return;
  if (process.env.NODE_ENV === "production") return;
  legacyKeyNoticeEmitted = true;
  console.warn(
    `[probe-docs] note: feature "${featureId}" (and possibly others) uses legacy "shell_docs_url" key; ` +
      `prefer "shell_docs_path" to match the canonical schema in generate-registry.ts`,
  );
}

interface FeatureDocStatus {
  og: DocState;
  shell: DocState;
}

// Soft-404 detection. docs.copilotkit.ai returns HTTP 200 with a
// client-rendered "Page Not Found" view for missing docs. Two signals:
//   (a) Next.js header "x-matched-path: /[[...slug]]" → catch-all fallback
//   (b) `<meta name="robots" content="noindex">` in body → page asks not to
//       be indexed, which docs sites only do for 404s and draft content.
// Both are robust across Next.js-hosted docs; we treat either as notfound.
const NOINDEX_PATTERN =
  /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex[^"']*["']/i;

async function probeOg(url: string | undefined): Promise<DocState> {
  if (!url) return "missing";
  // Hard timeout: without it, a hung upstream would stall the whole probe
  // run indefinitely (no default fetch timeout in Node). 10s is generous
  // enough for slow docs sites while still bounding CI cost.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    if (res.status === 404) return "notfound";
    if (res.status < 200 || res.status >= 400) return "error";
    const matched = res.headers.get("x-matched-path") ?? "";
    if (matched.includes("[[...") || matched.includes("[..."))
      return "notfound";
    const body = await res.text();
    if (NOINDEX_PATTERN.test(body)) return "notfound";
    return "ok";
  } catch (err) {
    // Log the URL + kind so a spike of "error" states can be diagnosed
    // (abort vs. DNS vs. TLS). Silent returns made the output useless.
    const e = err as Error & { code?: string; cause?: { code?: string } };
    const code = e.code ?? e.cause?.code ?? "";
    const detail = code ? `${e.name}:${code}` : e.name;
    console.warn(`[probe-docs] probeOg failed ${url} (${detail}): ${e.message}`);
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

function probeShell(docsPath: string | undefined): DocState {
  if (!docsPath) return "missing";
  // Strip leading /docs/ prefix to map to content root.
  const rel = docsPath.replace(/^\/docs\/?/, "").replace(/\/$/, "");
  const candidates = [
    path.join(SHELL_DOCS_ROOT, `${rel}.mdx`),
    path.join(SHELL_DOCS_ROOT, rel, "index.mdx"),
  ];
  return candidates.some((p) => fs.existsSync(p)) ? "ok" : "notfound";
}

async function main() {
  const raw = fs.readFileSync(REGISTRY_PATH, "utf-8");
  const registry = JSON.parse(raw) as { features: Feature[] };

  const results: Record<string, FeatureDocStatus> = {};

  // Probe OG URLs in parallel; shell check is sync filesystem.
  // Prefer `shell_docs_path` (canonical) and fall back to the legacy
  // `shell_docs_url` key — see header comment.
  const entries = await Promise.all(
    registry.features.map(async (f) => {
      const og = await probeOg(f.og_docs_url);
      const shellPath = f.shell_docs_path ?? f.shell_docs_url;
      if (f.shell_docs_path === undefined && f.shell_docs_url !== undefined) {
        noteLegacyShellDocsKey(f.id);
      }
      const shell = probeShell(shellPath);
      return [f.id, { og, shell }] as const;
    }),
  );
  for (const [id, status] of entries) results[id] = status;

  const generatedAt = new Date().toISOString();
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ generated_at: generatedAt, features: results }, null, 2),
  );

  // Per-feature summary is noisy; print aggregate counts.
  const counts = { ok: 0, missing: 0, notfound: 0, error: 0 };
  for (const s of Object.values(results)) {
    counts[s.og]++;
    counts[s.shell]++;
  }
  console.log(
    `Wrote ${OUTPUT_PATH} (${registry.features.length} features × 2 links)`,
  );
  console.log(
    `  ok=${counts.ok} notfound=${counts.notfound} error=${counts.error} missing=${counts.missing}`,
  );
}

main().catch((err) => {
  console.error("[probe-docs] fatal:", err);
  process.exit(1);
});
