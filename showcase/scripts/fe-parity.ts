#!/usr/bin/env node
/**
 * fe-parity.ts — Frontend parity checker for showcase integrations.
 *
 * Iron rule #2 (see showcase/AGENTS.md) says a feature's frontend is meant to
 * be byte-identical across integrations regardless of backend. The frontend is
 * NOT symlinked — every integration keeps its own real copy of the UI under
 * `src/app/demos/**` plus the app chrome — so those copies silently drift. This
 * tool measures that drift against a reference integration (default
 * `langgraph-python`, the north star) and reports exactly what must change to
 * reach byte-identical.
 *
 * What counts as the "frontend surface": every file under `src/**` with a UI
 * extension, EXCLUDING the backend (`src/agents/**`, `src/app/api/**`) and
 * test/QA files. Backend wiring legitimately differs per integration and is out
 * of scope here.
 *
 * Integration identity carve-out: a handful of files (notably
 * `app/layout.tsx`) legitimately carry the integration's name in a page
 * `<title>` or a log string. Before comparing, the candidate's identity tokens
 * (manifest `name`, its paren-stripped form, and `slug`) are rewritten to the
 * reference's. A file that is byte-identical only AFTER that rewrite is
 * reported as IDENTITY (acceptable) rather than DRIFT. That is the ONLY
 * sanctioned deviation from byte-identical.
 *
 * Statuses (per file): IDENTICAL · IDENTITY (name-only) · DRIFT · MISSING (in
 * candidate) · EXTRA (candidate-only). The gate fails (exit 1) on any DRIFT,
 * MISSING, or EXTRA *code* file. Docs (`.md`) and data (`.json`) are reported
 * for information only and never fail the gate.
 *
 * Usage (Node 23+ runs .ts directly; or `npx tsx`):
 *   node scripts/fe-parity.ts <slug>              # human report + exit code
 *   node scripts/fe-parity.ts <slug> --verbose    # also list identical files
 *   node scripts/fe-parity.ts <slug> --md         # markdown audit (paste-ready)
 *   node scripts/fe-parity.ts <slug> --md --full   # markdown, untruncated diffs
 *   node scripts/fe-parity.ts --all                # fleet ranking vs reference
 *   node scripts/fe-parity.ts <slug> --ref=<slug>  # compare against another ref
 *
 * Exit codes: 0 = at parity (code surface byte-identical modulo identity) ·
 * 1 = drift remaining · 2 = bad CLI input / unknown slug.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INTEGRATIONS = path.resolve(__dirname, "..", "integrations");

const CODE_EXT = new Set([".tsx", ".ts", ".jsx", ".js", ".css", ".scss", ".mjs", ".cjs"]);
const DOC_EXT = new Set([".md", ".mdx"]);
const DATA_EXT = new Set([".json"]);

type Status = "IDENTICAL" | "IDENTITY" | "DRIFT" | "MISSING" | "EXTRA";
type Kind = "code" | "doc" | "data";
interface FileResult {
  rel: string; // path relative to src/
  area: string; // "chrome" | "components" | "lib" | "demo:<id>" | "other:<dir>"
  kind: Kind;
  status: Status;
  diffLines: number; // for DRIFT
  refPath?: string;
  candPath?: string;
}

function fail(msg: string): never {
  console.error(`fe-parity: ${msg}`);
  process.exit(2);
}

function listIntegrations(): string[] {
  return fs
    .readdirSync(INTEGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .filter((s) => fs.existsSync(path.join(INTEGRATIONS, s, "src")))
    .sort();
}

/** Minimal manifest read — only `name` and `slug` scalars are needed. */
function readIdentity(slug: string): { slug: string; name: string } {
  const mf = path.join(INTEGRATIONS, slug, "manifest.yaml");
  let name = slug;
  try {
    for (const line of fs.readFileSync(mf, "utf8").split("\n")) {
      const m = /^name:\s*(.+?)\s*$/.exec(line);
      if (m) {
        name = m[1].replace(/^["']|["']$/g, "");
        break;
      }
    }
  } catch {
    /* no manifest — fall back to slug */
  }
  return { slug, name };
}

/** Rewrite candidate identity tokens -> reference identity tokens. */
function normalizeIdentity(
  text: string,
  cand: { slug: string; name: string },
  ref: { slug: string; name: string },
): string {
  const stripParens = (s: string) => s.replace(/[()]/g, "").replace(/\s+/g, " ").trim();
  const pairs: [string, string][] = [
    [cand.name, ref.name],
    [stripParens(cand.name), stripParens(ref.name)],
    [cand.slug, ref.slug],
  ];
  let out = text;
  for (const [from, to] of pairs) {
    if (from && from !== to) out = out.split(from).join(to);
  }
  return out;
}

function surfaceFiles(slug: string): Map<string, string> {
  // rel(src) -> absolute path, for every in-surface file
  const src = path.join(INTEGRATIONS, slug, "src");
  const out = new Map<string, string>();
  if (!fs.existsSync(src)) return out;
  const walk = (dir: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, d.name);
      const rel = path.relative(src, abs);
      if (d.isDirectory()) {
        // excluded roots / dirs
        if (rel === "agents" || rel === path.join("app", "api")) continue;
        if (d.name === "node_modules" || d.name === ".next" || d.name === "qa" || d.name === "tests") continue;
        walk(abs);
      } else if (d.isFile()) {
        if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(d.name)) continue;
        const ext = path.extname(d.name);
        if (CODE_EXT.has(ext) || DOC_EXT.has(ext) || DATA_EXT.has(ext)) out.set(rel, abs);
      }
    }
  };
  walk(src);
  return out;
}

function areaOf(rel: string): string {
  const p = rel.split(path.sep);
  if (p[0] === "app" && p[1] === "demos" && p[2]) return `demo:${p[2]}`;
  if (p[0] === "app") return "chrome";
  if (p[0] === "components") return "components";
  if (p[0] === "lib") return "lib";
  if (rel === "middleware.ts") return "chrome";
  return `other:${p[0]}`;
}

function kindOf(rel: string): Kind {
  const ext = path.extname(rel);
  if (DOC_EXT.has(ext)) return "doc";
  if (DATA_EXT.has(ext)) return "data";
  return "code";
}

function diffLineCount(a: string, b: string): number {
  try {
    execFileSync("diff", ["-u", a, b]);
    return 0;
  } catch (e: any) {
    const out: string = (e.stdout?.toString?.() ?? "") as string;
    return out
      .split("\n")
      .filter((l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---"))
      .length;
  }
}

function unifiedDiff(a: string, b: string, labelA?: string, labelB?: string): string {
  const args = labelA && labelB ? ["-u", "-L", labelA, "-L", labelB, a, b] : ["-u", a, b];
  try {
    execFileSync("diff", args);
    return "";
  } catch (e: any) {
    return (e.stdout?.toString?.() ?? "") as string;
  }
}

function compare(slug: string, refSlug: string): FileResult[] {
  const candId = readIdentity(slug);
  const refId = readIdentity(refSlug);
  const refFiles = surfaceFiles(refSlug);
  const candFiles = surfaceFiles(slug);
  const results: FileResult[] = [];

  for (const [rel, refAbs] of refFiles) {
    const candAbs = candFiles.get(rel);
    const base: FileResult = { rel, area: areaOf(rel), kind: kindOf(rel), status: "IDENTICAL", diffLines: 0, refPath: refAbs, candPath: candAbs };
    if (!candAbs) {
      results.push({ ...base, status: "MISSING" });
      continue;
    }
    const refBuf = fs.readFileSync(refAbs);
    const candBuf = fs.readFileSync(candAbs);
    if (refBuf.equals(candBuf)) {
      results.push({ ...base, status: "IDENTICAL" });
      continue;
    }
    // identity-normalized comparison
    const refText = refBuf.toString("utf8");
    const candNorm = normalizeIdentity(candBuf.toString("utf8"), candId, refId);
    if (candNorm === refText) {
      results.push({ ...base, status: "IDENTITY" });
      continue;
    }
    results.push({ ...base, status: "DRIFT", diffLines: diffLineCount(refAbs, candAbs) });
  }
  // candidate-only files (extra)
  for (const [rel, candAbs] of candFiles) {
    if (!refFiles.has(rel)) {
      results.push({ rel, area: areaOf(rel), kind: kindOf(rel), status: "EXTRA", diffLines: 0, candPath: candAbs });
    }
  }
  return results;
}

const GATE_FAIL: Status[] = ["DRIFT", "MISSING", "EXTRA"];
function gatePasses(rs: FileResult[]): boolean {
  return !rs.some((r) => r.kind === "code" && GATE_FAIL.includes(r.status));
}

// ---- reporters -------------------------------------------------------------

const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};
const mark = (s: Status) =>
  s === "IDENTICAL" ? C.green("IDENTICAL") : s === "IDENTITY" ? C.green("IDENTITY ") : s === "DRIFT" ? C.red("DRIFT    ") : s === "MISSING" ? C.red("MISSING  ") : C.yellow("EXTRA    ");

function summarize(rs: FileResult[]) {
  const code = rs.filter((r) => r.kind === "code");
  const by = (s: Status) => code.filter((r) => r.status === s).length;
  return {
    code: code.length,
    identical: by("IDENTICAL"),
    identity: by("IDENTITY"),
    drift: by("DRIFT"),
    missing: by("MISSING"),
    extra: by("EXTRA"),
    docsData: rs.filter((r) => r.kind !== "code" && GATE_FAIL.includes(r.status)).length,
  };
}

function humanReport(slug: string, refSlug: string, rs: FileResult[], verbose: boolean) {
  console.log(C.bold(`\nFrontend parity: ${slug}  vs  ${refSlug}`));
  console.log(C.dim(`Surface: src/** UI files, excluding agents/, app/api/, tests, qa\n`));

  // group by area, chrome first, then components/lib, then demos
  const areas = [...new Set(rs.map((r) => r.area))];
  const order = (a: string) => (a === "chrome" ? 0 : a === "components" ? 1 : a === "lib" ? 2 : a.startsWith("demo:") ? 3 : 4);
  areas.sort((a, b) => order(a) - order(b) || a.localeCompare(b));

  for (const area of areas) {
    const files = rs.filter((r) => r.area === area);
    const problems = files.filter((r) => r.status !== "IDENTICAL");
    if (area === "components" || area === "lib") {
      const total = files.length;
      const clean = files.filter((r) => r.status === "IDENTICAL" || r.status === "IDENTITY").length;
      const tag = problems.length ? C.red(`${total - clean} differ`) : C.green("all identical");
      console.log(`${C.bold(area.toUpperCase())}  ${clean}/${total} ${tag}`);
      for (const r of problems) console.log(`   ${mark(r.status)} ${r.rel}${r.status === "DRIFT" ? C.dim(` (${r.diffLines} lines)`) : ""}`);
      continue;
    }
    const label = area.startsWith("demo:") ? area.slice(5) : area.toUpperCase();
    if (!verbose && problems.length === 0 && area.startsWith("demo:")) continue; // hide clean demos
    if (area.startsWith("demo:")) {
      if (problems.length === 0) {
        if (verbose) console.log(`${C.green("✓")} demo ${label} — identical`);
        continue;
      }
      console.log(C.bold(`demo ${label}`));
    } else {
      console.log(C.bold(area.toUpperCase()));
    }
    for (const r of files) {
      if (!verbose && r.status === "IDENTICAL") continue;
      console.log(`   ${mark(r.status)} ${r.rel}${r.status === "DRIFT" ? C.dim(` (${r.diffLines} lines)`) : ""}`);
    }
  }

  const s = summarize(rs);
  const cleanDemos = [...new Set(rs.filter((r) => r.area.startsWith("demo:")).map((r) => r.area))].filter(
    (a) => !rs.some((r) => r.area === a && r.status !== "IDENTICAL"),
  ).length;
  const totalDemos = new Set(rs.filter((r) => r.area.startsWith("demo:")).map((r) => r.area)).size;
  console.log(C.bold(`\nSUMMARY`));
  console.log(`  code files: ${s.code} | ${C.green(`${s.identical} identical`)}, ${s.identity} identity-only, ${C.red(`${s.drift} drift`)}, ${C.red(`${s.missing} missing`)}, ${C.yellow(`${s.extra} extra`)}`);
  console.log(`  demos: ${cleanDemos}/${totalDemos} byte-identical`);
  if (s.docsData) console.log(C.dim(`  (docs/data files differing, non-gating: ${s.docsData})`));
  const pass = gatePasses(rs);
  console.log(pass ? C.green(`\nPARITY: ✓ frontend is byte-identical (modulo integration name).`) : C.red(`\nPARITY: ✗ not yet — ${s.drift} drift, ${s.missing} missing, ${s.extra} extra code file(s).`));
}

function fleetReport(refSlug: string) {
  const rows = listIntegrations()
    .filter((s) => s !== refSlug)
    .map((slug) => {
      const rs = compare(slug, refSlug);
      const s = summarize(rs);
      const totalDemos = new Set(rs.filter((r) => r.area.startsWith("demo:")).map((r) => r.area)).size;
      const cleanDemos = [...new Set(rs.filter((r) => r.area.startsWith("demo:")).map((r) => r.area))].filter(
        (a) => !rs.some((r) => r.area === a && r.status !== "IDENTICAL"),
      ).length;
      return { slug, ...s, cleanDemos, totalDemos, gap: s.drift + s.missing + s.extra };
    })
    .sort((a, b) => a.gap - b.gap || a.slug.localeCompare(b.slug));
  console.log(C.bold(`\nFrontend parity vs ${refSlug} (code files; lower gap = closer)\n`));
  console.log(`${"SLUG".padEnd(24)}${"GAP".padStart(5)}${"DRIFT".padStart(7)}${"MISS".padStart(6)}${"EXTRA".padStart(7)}${"CLEAN-DEMOS".padStart(13)}`);
  for (const r of rows) {
    const line = `${r.slug.padEnd(24)}${String(r.gap).padStart(5)}${String(r.drift).padStart(7)}${String(r.missing).padStart(6)}${String(r.extra).padStart(7)}${`${r.cleanDemos}/${r.totalDemos}`.padStart(13)}`;
    console.log(r.gap === 0 ? C.green(line) : line);
  }
  console.log(C.dim(`\nGAP = drift + missing + extra code files. CLEAN-DEMOS = demo dirs byte-identical to ${refSlug}.`));
}

function truncate(diff: string, full: boolean, n = 60): string {
  if (full) return diff;
  const lines = diff.split("\n");
  if (lines.length <= n) return diff;
  return lines.slice(0, n).join("\n") + `\n… (${lines.length - n} more lines — rerun with --full)`;
}

function markdownReport(slug: string, refSlug: string, rs: FileResult[], full: boolean) {
  const s = summarize(rs);
  const totalDemos = new Set(rs.filter((r) => r.area.startsWith("demo:")).map((r) => r.area)).size;
  const cleanDemos = [...new Set(rs.filter((r) => r.area.startsWith("demo:")).map((r) => r.area))].filter(
    (a) => !rs.some((r) => r.area === a && r.status !== "IDENTICAL"),
  ).length;
  const L: string[] = [];
  L.push(`# Frontend parity audit: \`${slug}\` → \`${refSlug}\``);
  L.push("");
  L.push(`Goal: byte-identical frontend to the \`${refSlug}\` north star (modulo the integration's own name/title).`);
  L.push("");
  L.push(`**Surface:** \`src/**\` UI files, excluding \`agents/\`, \`app/api/\`, tests, qa.`);
  L.push("");
  L.push(`| Metric | Count |`);
  L.push(`| --- | --- |`);
  L.push(`| Code files compared | ${s.code} |`);
  L.push(`| Byte-identical | ${s.identical} |`);
  L.push(`| Identity-only (name/title) | ${s.identity} |`);
  L.push(`| **Drift (must fix)** | **${s.drift}** |`);
  L.push(`| **Missing (must add)** | **${s.missing}** |`);
  L.push(`| **Extra (must remove/justify)** | **${s.extra}** |`);
  L.push(`| Demos byte-identical | ${cleanDemos}/${totalDemos} |`);
  L.push("");

  const problems = rs.filter((r) => r.status !== "IDENTICAL" && r.status !== "IDENTITY");
  if (problems.length === 0) {
    L.push(`✅ **At parity** — every frontend code file is byte-identical (modulo name).`);
  } else {
    // chrome first
    const areas = [...new Set(problems.map((r) => r.area))].sort((a, b) => {
      const o = (x: string) => (x === "chrome" ? 0 : x === "components" ? 1 : x === "lib" ? 2 : 3);
      return o(a) - o(b) || a.localeCompare(b);
    });
    for (const area of areas) {
      const label = area.startsWith("demo:") ? `Demo: \`${area.slice(5)}\`` : area.toUpperCase();
      L.push(`## ${label}`);
      L.push("");
      for (const r of problems.filter((x) => x.area === area)) {
        if (r.status === "MISSING") {
          L.push(`- \`${r.rel}\` — **MISSING** in \`${slug}\` (present in \`${refSlug}\`). Add it.`);
          continue;
        }
        if (r.status === "EXTRA") {
          L.push(`- \`${r.rel}\` — **EXTRA** in \`${slug}\` (not in \`${refSlug}\`). Remove or justify.`);
          continue;
        }
        L.push(`- \`${r.rel}\` — **DRIFT** (${r.diffLines} diff lines)`);
        if (r.kind === "code" && r.refPath && r.candPath) {
          const d = unifiedDiff(r.refPath, r.candPath, `${refSlug}/src/${r.rel}`, `${slug}/src/${r.rel}`);
          if (d) {
            L.push("");
            L.push("```diff");
            L.push(truncate(d, full).trimEnd());
            L.push("```");
          }
        }
      }
      L.push("");
    }
  }
  L.push(`---`);
  L.push(`_Generated by \`showcase/scripts/fe-parity.ts\`. \`-\` = ${refSlug} (reference), \`+\` = ${slug}._`);
  console.log(L.join("\n"));
}

// ---- main ------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("--") && !a.includes("=")));
  const refArg = argv.find((a) => a.startsWith("--ref="));
  const refSlug = refArg ? refArg.split("=")[1] : "langgraph-python";
  const positional = argv.filter((a) => !a.startsWith("--"));

  const all = listIntegrations();
  if (!all.includes(refSlug)) fail(`reference slug "${refSlug}" not found under integrations/`);

  if (flags.has("--all")) {
    fleetReport(refSlug);
    return;
  }

  const slug = positional[0];
  if (!slug) fail(`usage: fe-parity <slug> [--verbose|--md|--full|--ref=<slug>] | fe-parity --all`);
  if (!all.includes(slug)) fail(`slug "${slug}" not found under integrations/`);
  if (slug === refSlug) fail(`"${slug}" is the reference — nothing to compare`);

  const rs = compare(slug, refSlug);
  if (flags.has("--md")) markdownReport(slug, refSlug, rs, flags.has("--full"));
  else humanReport(slug, refSlug, rs, flags.has("--verbose"));

  process.exit(gatePasses(rs) ? 0 : 1);
}

main();
