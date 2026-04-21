/**
 * Minimal Prometheus-format metrics registry (spec §9 Phase 5).
 *
 * Zero external dependencies — we don't need prom-client's full feature
 * set; this service exposes a handful of counters and one histogram.
 * Keeping it in-house means no extra surface area to keep patched.
 *
 * Counters:  probe_runs, alert_matches, alert_sends, rule_reloads,
 *            webhook_rejections, hmac_failures (deprecated alias)
 * Histogram: probe_duration_ms (buckets: 10, 50, 100, 500, 1000, 5000 ms)
 *
 * All metrics carry `showcase_ops_` prefix on export.
 *
 * `webhook_rejections{reason=...}` replaces the earlier `hmac_failures`
 * counter. Every webhook rejection (HMAC and payload validation) now
 * increments the unified counter so dashboards can't miss a category.
 *
 * DEPRECATION: `hmac_failures` remains incrementable as an alias — any
 * `webhook_rejections` increment whose reason falls into `HMAC_REASONS`
 * also bumps `hmac_failures` so existing Grafana panels don't go dark.
 * New callers MUST use `webhook_rejections`. Panels that sum BOTH
 * counters will double-count HMAC rejections — switch to
 * `webhook_rejections` only.
 *
 * Sunset: remove the alias (and `hmac_failures` from COUNTER_NAMES /
 * COUNTER_HELP) once no production dashboard queries it. Track removal
 * intent in the showcase-ops deprecation backlog rather than leaving
 * it as a dangling "grace period" forever.
 */

// HMAC-verification reason codes. Kept in sync with `HmacVerifyResult`
// in ./hmac.ts — when we add/split/remove reasons there, mirror them
// here so the `hmac_failures` deprecated alias still covers every HMAC-
// category rejection. Non-HMAC reasons (invalid-json, invalid-payload,
// unknown) must NOT appear here.
const HMAC_REASONS = new Set([
  "stale",
  "bad-signature",
  "missing-headers",
  "missing-timestamp",
  "missing-signature",
  "invalid-timestamp",
  "invalid-signature-format",
]);

const COUNTER_NAMES = [
  "probe_runs",
  "alert_matches",
  "alert_sends",
  "rule_reloads",
  "webhook_rejections",
  "hmac_failures",
] as const;
type CounterName = (typeof COUNTER_NAMES)[number];

const HISTOGRAM_NAMES = ["probe_duration_ms"] as const;
type HistogramName = (typeof HISTOGRAM_NAMES)[number];

const HISTOGRAM_BUCKETS: Record<HistogramName, number[]> = {
  probe_duration_ms: [10, 50, 100, 500, 1000, 5000],
};

const COUNTER_HELP: Record<CounterName, string> = {
  probe_runs: "Total probe executions grouped by dimension/key.",
  alert_matches: "Total rule evaluations that matched, grouped by rule id.",
  alert_sends: "Total alert deliveries grouped by target kind.",
  rule_reloads: "Total times the rule loader has reloaded from disk.",
  webhook_rejections:
    "Total webhook request rejections grouped by reason (HMAC verify + payload validation).",
  hmac_failures:
    "DEPRECATED. Alias of webhook_rejections filtered to HMAC-verification reasons. Prefer webhook_rejections{reason=...}.",
};

const HISTOGRAM_HELP: Record<HistogramName, string> = {
  probe_duration_ms: "Probe handler duration in milliseconds.",
};

type Labels = Record<string, string>;

function labelKey(labels: Labels | undefined): string {
  if (!labels) return "";
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]}`).join(",");
}

function formatLabels(labels: Labels | undefined): string {
  if (!labels || Object.keys(labels).length === 0) return "";
  const pairs = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${escapeLabelValue(labels[k]!)}"`);
  return `{${pairs.join(",")}}`;
}

function formatLabelsWithLe(labels: Labels | undefined, le: string): string {
  const merged: Labels = { ...(labels ?? {}), le };
  return formatLabels(merged);
}

function escapeLabelValue(v: string): string {
  // Order matters: escape backslashes first so the subsequent replacements
  // don't re-escape their own inserted backslashes. `\r` is handled in
  // addition to `\n` because Windows-origin label values (file paths,
  // commit messages) otherwise produce malformed exposition output.
  return v
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

interface CounterSeries {
  labels: Labels | undefined;
  value: number;
}

interface HistogramSeries {
  labels: Labels | undefined;
  count: number;
  sum: number;
  buckets: Map<number, number>; // upper-bound -> cumulative count
}

export interface MetricsRegistry {
  inc(name: CounterName, labels?: Labels): void;
  observe(name: HistogramName, value: number, labels?: Labels): void;
  /** For testing — read the raw counter series map. */
  _counters(): Map<CounterName, Map<string, CounterSeries>>;
  _histograms(): Map<HistogramName, Map<string, HistogramSeries>>;
}

export function createMetricsRegistry(): MetricsRegistry {
  const counters = new Map<CounterName, Map<string, CounterSeries>>();
  for (const n of COUNTER_NAMES) counters.set(n, new Map());

  const histograms = new Map<HistogramName, Map<string, HistogramSeries>>();
  for (const n of HISTOGRAM_NAMES) histograms.set(n, new Map());

  function incOne(name: CounterName, labels: Labels | undefined): void {
    const bucket = counters.get(name)!;
    const k = labelKey(labels);
    const existing = bucket.get(k);
    if (existing) {
      existing.value += 1;
    } else {
      bucket.set(k, { labels, value: 1 });
    }
  }

  return {
    inc(name, labels) {
      incOne(name, labels);
      // Deprecated alias mirror: a `webhook_rejections` increment whose
      // reason falls into the HMAC-verification category also bumps
      // `hmac_failures` so existing dashboards don't go dark during the
      // deprecation window. The mirror is skipped for non-HMAC reasons
      // (invalid-json, invalid-payload, ...) to preserve the alias's
      // historical meaning.
      if (name === "webhook_rejections") {
        const reason = labels?.reason;
        if (reason && HMAC_REASONS.has(reason)) {
          incOne("hmac_failures", labels);
        }
      }
    },
    observe(name, value, labels) {
      const bucket = histograms.get(name)!;
      const k = labelKey(labels);
      let series = bucket.get(k);
      if (!series) {
        const buckets = new Map<number, number>();
        for (const b of HISTOGRAM_BUCKETS[name]) buckets.set(b, 0);
        series = { labels, count: 0, sum: 0, buckets };
        bucket.set(k, series);
      }
      series.count += 1;
      series.sum += value;
      for (const b of HISTOGRAM_BUCKETS[name]) {
        if (value <= b) series.buckets.set(b, series.buckets.get(b)! + 1);
      }
    },
    _counters() {
      return counters;
    },
    _histograms() {
      return histograms;
    },
  };
}

export function renderPrometheus(reg: MetricsRegistry): string {
  const lines: string[] = [];
  for (const name of COUNTER_NAMES) {
    const bucket = reg._counters().get(name)!;
    lines.push(`# HELP showcase_ops_${name} ${COUNTER_HELP[name]}`);
    lines.push(`# TYPE showcase_ops_${name} counter`);
    if (bucket.size === 0) {
      lines.push(`showcase_ops_${name} 0`);
      continue;
    }
    for (const series of bucket.values()) {
      lines.push(
        `showcase_ops_${name}${formatLabels(series.labels)} ${series.value}`,
      );
    }
  }
  for (const name of HISTOGRAM_NAMES) {
    const bucket = reg._histograms().get(name)!;
    lines.push(`# HELP showcase_ops_${name} ${HISTOGRAM_HELP[name]}`);
    lines.push(`# TYPE showcase_ops_${name} histogram`);
    if (bucket.size === 0) {
      // Consistency with counters: always emit a zero-count series so a
      // TYPE/HELP line is never orphaned. Includes every configured bucket
      // plus the mandatory `+Inf` so scrapers see the full schema.
      for (const b of HISTOGRAM_BUCKETS[name]) {
        lines.push(
          `showcase_ops_${name}_bucket${formatLabelsWithLe(undefined, String(b))} 0`,
        );
      }
      lines.push(
        `showcase_ops_${name}_bucket${formatLabelsWithLe(undefined, "+Inf")} 0`,
      );
      lines.push(`showcase_ops_${name}_sum 0`);
      lines.push(`showcase_ops_${name}_count 0`);
      continue;
    }
    for (const series of bucket.values()) {
      for (const b of HISTOGRAM_BUCKETS[name]) {
        lines.push(
          `showcase_ops_${name}_bucket${formatLabelsWithLe(series.labels, String(b))} ${series.buckets.get(b)!}`,
        );
      }
      lines.push(
        `showcase_ops_${name}_bucket${formatLabelsWithLe(series.labels, "+Inf")} ${series.count}`,
      );
      lines.push(
        `showcase_ops_${name}_sum${formatLabels(series.labels)} ${series.sum}`,
      );
      lines.push(
        `showcase_ops_${name}_count${formatLabels(series.labels)} ${series.count}`,
      );
    }
  }
  return lines.join("\n") + "\n";
}
