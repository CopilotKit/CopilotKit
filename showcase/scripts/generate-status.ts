// Generate showcase/shell/src/data/status.json — the readiness-rollup
// bundle the shell-dashboard feature matrix reads to color each cell.
//
// Health signals are REAL: we probe every integration's
// `backend_url + demo.route` in parallel and record up/down/unknown.
//
// E2E, Smoke, and QA are placeholder right now. The spots are wired so
// that a future CI workflow (`showcase_aimock-e2e.yml`,
// `showcase_smoke-monitor.yml`, `showcase_qa-sync.yml`) or a Notion
// exporter can write authoritative results into the same file.
//
// Usage:
//   npx tsx showcase/scripts/generate-status.ts            # real health + mock rest
//   GENERATE_STATUS_MOCK_HEALTH=1 npx tsx ...              # mock everything (offline)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(ROOT, "shell", "src", "data", "registry.json");
const OUTPUT_PATH = path.join(ROOT, "shell", "src", "data", "status.json");

type TestState = "pass" | "fail";
type HealthState = "up" | "down" | "unknown";

interface TestResult {
  status: TestState;
  ran_at: string;
  url: string;
}
interface QAResult {
  reviewed_at: string;
  url: string;
}
interface HealthResult {
  status: HealthState;
  checked_at: string;
}
interface DemoStatus {
  e2e: TestResult | null;
  smoke: TestResult | null;
  qa: QAResult | null;
  health: HealthResult;
}

// Deterministic hash so mock values are stable across runs.
function hash(s: string): number {
  let h = 0;
  for (const c of s) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}
function daysAgo(d: number): string {
  return new Date(Date.now() - d * 86400 * 1000).toISOString();
}

// TODO(wire-e2e): replace with a reader that ingests artifacts from
// `showcase_aimock-e2e.yml` or the nx test cache. Kept deterministic and
// seed-based so the UI has realistic variety until that's wired.
function mockE2E(slug: string, demoId: string): TestResult | null {
  const seed = hash(slug + "::e2e::" + demoId);
  const state = ["pass-fresh", "pass-stale", "fail", "none"][seed % 4];
  if (state === "none") return null;
  return {
    status: state.startsWith("pass") ? "pass" : "fail",
    ran_at:
      state === "pass-fresh"
        ? hoursAgo(1 + (seed % 5))
        : hoursAgo(10 + (seed % 60)),
    url: "https://github.com/CopilotKit/CopilotKit/actions",
  };
}

// TODO(wire-smoke): replace with a reader for `showcase_smoke-monitor.yml`
// results.
function mockSmoke(slug: string, demoId: string): TestResult | null {
  const seed = hash(slug + "::smoke::" + demoId);
  const state = ["pass-fresh", "pass-stale", "fail", "none"][seed % 4];
  if (state === "none") return null;
  return {
    status: state.startsWith("pass") ? "pass" : "fail",
    ran_at:
      state === "pass-fresh" ? hoursAgo(seed % 3) : hoursAgo(5 + (seed % 40)),
    url: "https://github.com/CopilotKit/CopilotKit/actions",
  };
}

// TODO(wire-qa): extend `showcase_qa-sync.yml` to write Notion's last
// sign-off timestamp back into this file.
function mockQA(slug: string, demoId: string): QAResult | null {
  const seed = hash(slug + "::qa::" + demoId);
  const days = seed % 55;
  if (days > 45) return null; // never reviewed
  return {
    reviewed_at: daysAgo(days),
    url: "https://copilotkit.notion.site",
  };
}

async function probeHealth(url: string): Promise<HealthState> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
      return res.ok ? "up" : "down";
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return "unknown";
  }
}

async function main() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8")) as {
    integrations: Array<{
      slug: string;
      backend_url: string;
      demos: Array<{ id: string; route: string }>;
    }>;
  };

  const mockHealth = process.env.GENERATE_STATUS_MOCK_HEALTH === "1";

  // Flatten to (slug, demoId, url) tuples for parallel probing.
  // Informational demos (e.g. cli-start) have no route — skip probing.
  const jobs: Array<{ slug: string; demoId: string; url: string }> = [];
  for (const integ of registry.integrations) {
    for (const demo of integ.demos) {
      if (!demo.route) continue;
      jobs.push({
        slug: integ.slug,
        demoId: demo.id,
        url: `${integ.backend_url}${demo.route}`,
      });
    }
  }

  console.log(
    `Probing ${jobs.length} demo URLs${mockHealth ? " (MOCKED)" : ""}...`,
  );
  const healthMap = new Map<string, HealthState>();
  const checkedAt = new Date().toISOString();

  if (mockHealth) {
    for (const j of jobs) {
      const seed = hash(j.slug + "::health::" + j.demoId);
      const state: HealthState = (
        ["up", "up", "up", "up", "down", "unknown"] as const
      )[seed % 6];
      healthMap.set(`${j.slug}::${j.demoId}`, state);
    }
  } else {
    const results = await Promise.all(
      jobs.map(
        async (j) =>
          [`${j.slug}::${j.demoId}`, await probeHealth(j.url)] as const,
      ),
    );
    for (const [k, v] of results) healthMap.set(k, v);
  }

  const integrations: Record<string, { demos: Record<string, DemoStatus> }> =
    {};
  for (const integ of registry.integrations) {
    const demos: Record<string, DemoStatus> = {};
    for (const demo of integ.demos) {
      const key = `${integ.slug}::${demo.id}`;
      const parentHealth = healthMap.get(key) ?? "unknown";
      demos[demo.id] = {
        e2e: mockE2E(integ.slug, demo.id),
        smoke: mockSmoke(integ.slug, demo.id),
        qa: mockQA(integ.slug, demo.id),
        health: { status: parentHealth, checked_at: checkedAt },
      };
    }
    integrations[integ.slug] = { demos };
  }

  const bundle = {
    generated_at: new Date().toISOString(),
    integrations,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(bundle, null, 2) + "\n");
  console.log(`Wrote ${OUTPUT_PATH}`);

  // Per-integration health summary so the operator sees what's live.
  const summary: Record<string, Record<HealthState, number>> = {};
  for (const [k, v] of healthMap) {
    const slug = k.split("::")[0];
    summary[slug] ||= { up: 0, down: 0, unknown: 0 };
    summary[slug][v]++;
  }
  const rows = Object.entries(summary).map(
    ([slug, c]) =>
      `  ${slug.padEnd(26)} up=${c.up} down=${c.down} unknown=${c.unknown}`,
  );
  console.log("\nHealth summary:\n" + rows.join("\n"));
}

main();
