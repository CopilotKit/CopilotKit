#!/usr/bin/env tsx
/**
 * Load test simulating 50 keys × 5-minute cadence against a local or
 * deployed showcase-ops (spec §9 Phase 5).
 *
 * For each iteration (default: 3), the script fires a burst of 50
 * requests to each probed endpoint, records per-request latency, and
 * prints a summary table of p50/p95/p99 per endpoint. Exit code 0 on
 * success; non-zero when any percentile breaches a configurable
 * threshold (see LOAD_TEST_MAX_MS, default 5000).
 *
 * Usage:
 *   tsx scripts/load-test.ts --url https://showcase-ops.railway.app
 *
 * Env overrides:
 *   LOAD_TEST_URL        (alias for --url)
 *   LOAD_TEST_KEYS       number of simulated keys per burst (default 50)
 *   LOAD_TEST_ITERATIONS number of bursts (default 3)
 *   LOAD_TEST_MAX_MS     fail if p99 exceeds this (default 5000)
 */

interface EndpointSpec {
  label: string;
  path: string;
  method?: "GET" | "POST";
  body?: () => string;
  headers?: Record<string, string>;
}

const ENDPOINTS: EndpointSpec[] = [
  { label: "GET /health", path: "/health" },
  { label: "GET /metrics", path: "/metrics" },
];

const args = process.argv.slice(2);
const urlFlagIdx = args.indexOf("--url");
const url =
  (urlFlagIdx !== -1 ? args[urlFlagIdx + 1] : undefined) ??
  process.env.LOAD_TEST_URL ??
  "http://localhost:8080";
const keys = Number(process.env.LOAD_TEST_KEYS ?? "50");
const iterations = Number(process.env.LOAD_TEST_ITERATIONS ?? "3");
const maxMs = Number(process.env.LOAD_TEST_MAX_MS ?? "5000");

/**
 * Nearest-rank percentile. Note `p=1.0` returns the last element (max), which
 * is expected behavior for small n: with the default 50 requests/iteration,
 * p99 effectively degenerates to the max. If that ambiguity matters, pass a
 * larger LOAD_TEST_KEYS to get a stable p99.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

async function measure(spec: EndpointSpec): Promise<number> {
  const start = Date.now();
  const res = await fetch(`${url}${spec.path}`, {
    method: spec.method ?? "GET",
    body: spec.body?.(),
    headers: spec.headers,
  });
  // Drain response so the measurement includes body transfer.
  await res.text();
  if (!res.ok && res.status !== 404) {
    throw new Error(`${spec.label} → HTTP ${res.status}`);
  }
  // 404 on /metrics is not fatal (some deploys disable the endpoint) but it
  // IS operationally visible — warn so operators notice if they expected
  // metrics to be enabled.
  if (res.status === 404) {
    console.warn(
      `WARN: ${spec.label} returned 404 — endpoint disabled on this deploy?`,
    );
  }
  return Date.now() - start;
}

async function runBurst(spec: EndpointSpec, count: number): Promise<number[]> {
  const tasks: Promise<number>[] = [];
  for (let i = 0; i < count; i++) {
    tasks.push(measure(spec));
  }
  return Promise.all(tasks);
}

async function main(): Promise<void> {
  console.log(
    `load-test against ${url}: ${iterations} iterations × ${keys} keys`,
  );
  const perEndpoint = new Map<string, number[]>();
  for (const ep of ENDPOINTS) perEndpoint.set(ep.label, []);

  for (let i = 0; i < iterations; i++) {
    for (const ep of ENDPOINTS) {
      const timings = await runBurst(ep, keys);
      perEndpoint.get(ep.label)!.push(...timings);
      console.log(
        `  iter ${i + 1}/${iterations} ${ep.label}: ${timings.length} requests, min=${Math.min(...timings)}ms max=${Math.max(...timings)}ms`,
      );
    }
  }

  let failed = false;
  console.log("\nper-endpoint latency percentiles (ms):");
  console.log("endpoint                         p50    p95    p99    n");
  console.log("-------------------------------- ------ ------ ------ -----");
  for (const [label, timings] of perEndpoint) {
    const sorted = [...timings].sort((a, b) => a - b);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const p99 = percentile(sorted, 0.99);
    console.log(
      `${label.padEnd(32)} ${String(p50).padStart(6)} ${String(p95).padStart(6)} ${String(p99).padStart(6)} ${String(sorted.length).padStart(5)}`,
    );
    if (p99 > maxMs) {
      console.error(`FAIL: ${label} p99=${p99}ms exceeds threshold ${maxMs}ms`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error("load-test crashed:", err);
  process.exit(2);
});
