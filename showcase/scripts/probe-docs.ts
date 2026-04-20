// Docs-link probe.
//
// Reads shared/feature-registry.json; for each feature:
//   - og_docs_url   → HTTP HEAD. 2xx = "ok", else "notfound" / "error".
//   - shell_docs_url (relative path like "/docs/features/agentic-chat")
//                   → check shell-docs/src/content/docs/<path>.mdx (or index.mdx).
//                     file exists = "ok", else "notfound". No network.
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
  shell_docs_url?: string;
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
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    if (res.status === 404) return "notfound";
    if (res.status < 200 || res.status >= 400) return "error";
    const matched = res.headers.get("x-matched-path") ?? "";
    if (matched.includes("[[...") || matched.includes("[..."))
      return "notfound";
    const body = await res.text();
    if (NOINDEX_PATTERN.test(body)) return "notfound";
    return "ok";
  } catch {
    return "error";
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
  const entries = await Promise.all(
    registry.features.map(async (f) => {
      const og = await probeOg(f.og_docs_url);
      const shell = probeShell(f.shell_docs_url);
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
