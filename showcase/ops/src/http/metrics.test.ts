/**
 * Tests for the Prometheus-format `/metrics` endpoint (spec §9 Phase 5).
 */
import { describe, it, expect } from "vitest";
import { createMetricsRegistry, renderPrometheus } from "./metrics.js";

describe("metrics registry", () => {
  it("exposes the five baseline counters as TYPE-annotated Prometheus text", () => {
    const reg = createMetricsRegistry();
    reg.inc("probe_runs", { dimension: "smoke" });
    reg.inc("probe_runs", { dimension: "smoke" });
    reg.inc("probe_runs", { dimension: "health" });
    reg.inc("alert_matches", { rule: "smoke-red-tick" });
    reg.inc("alert_sends", { target: "slack_webhook" });
    reg.inc("rule_reloads");
    reg.inc("hmac_failures");

    const text = renderPrometheus(reg);

    expect(text).toContain("# TYPE showcase_ops_probe_runs counter");
    expect(text).toContain('showcase_ops_probe_runs{dimension="smoke"} 2');
    expect(text).toContain('showcase_ops_probe_runs{dimension="health"} 1');
    expect(text).toContain("# TYPE showcase_ops_alert_matches counter");
    expect(text).toContain(
      'showcase_ops_alert_matches{rule="smoke-red-tick"} 1',
    );
    expect(text).toContain("# TYPE showcase_ops_alert_sends counter");
    expect(text).toContain("# TYPE showcase_ops_rule_reloads counter");
    // Anchor to line-start/end so `rule_reloads 1` isn't satisfied by e.g.
    // `rule_reloads 10`. Same rationale for hmac_failures below.
    expect(text).toMatch(/^showcase_ops_rule_reloads\s+1$/m);
    expect(text).toContain("# TYPE showcase_ops_hmac_failures counter");
    expect(text).toMatch(/^showcase_ops_hmac_failures\s+1$/m);
  });

  it("emits HELP lines with a description for every metric", () => {
    const reg = createMetricsRegistry();
    reg.observe("probe_duration_ms", 10);
    const text = renderPrometheus(reg);
    expect(text).toMatch(/^# HELP showcase_ops_probe_runs .+/m);
    expect(text).toMatch(/^# HELP showcase_ops_alert_matches .+/m);
    expect(text).toMatch(/^# HELP showcase_ops_alert_sends .+/m);
    expect(text).toMatch(/^# HELP showcase_ops_rule_reloads .+/m);
    expect(text).toMatch(/^# HELP showcase_ops_hmac_failures .+/m);
    expect(text).toMatch(/^# HELP showcase_ops_probe_duration_ms .+/m);
  });

  it("records histogram observations for probe latency", () => {
    const reg = createMetricsRegistry();
    reg.observe("probe_duration_ms", 42, { dimension: "smoke" });
    reg.observe("probe_duration_ms", 150, { dimension: "smoke" });
    reg.observe("probe_duration_ms", 2500, { dimension: "smoke" });

    const text = renderPrometheus(reg);
    expect(text).toContain("# TYPE showcase_ops_probe_duration_ms histogram");
    expect(text).toMatch(
      /showcase_ops_probe_duration_ms_bucket\{dimension="smoke",le="100"\}\s+1/,
    );
    expect(text).toMatch(
      /showcase_ops_probe_duration_ms_bucket\{dimension="smoke",le="1000"\}\s+2/,
    );
    expect(text).toMatch(
      /showcase_ops_probe_duration_ms_bucket\{dimension="smoke",le="\+Inf"\}\s+3/,
    );
    expect(text).toMatch(
      /showcase_ops_probe_duration_ms_count\{dimension="smoke"\}\s+3/,
    );
  });

  it("escapes label values with backslashes and quotes", () => {
    const reg = createMetricsRegistry();
    reg.inc("probe_runs", { dimension: 'a"b\\c' });
    const text = renderPrometheus(reg);
    expect(text).toContain('showcase_ops_probe_runs{dimension="a\\"b\\\\c"}');
  });

  it("escapes \\r and \\n in label values", () => {
    const reg = createMetricsRegistry();
    reg.inc("probe_runs", { dimension: "line1\r\nline2" });
    const text = renderPrometheus(reg);
    expect(text).toContain(
      'showcase_ops_probe_runs{dimension="line1\\r\\nline2"}',
    );
  });

  it("emits a zero-valued empty histogram with full bucket schema before any observation", () => {
    // Regression: prior to this we emitted `_sum`/`_count` with no labels
    // for empty histograms, then labelled series for populated ones —
    // Prometheus scrapers relying on consistent dimensionality would
    // silently drop one form. The empty shape must include every
    // configured upper bound + `+Inf` and a zero sum/count with no
    // labels.
    const reg = createMetricsRegistry();
    const text = renderPrometheus(reg);
    for (const bound of ["10", "50", "100", "500", "1000", "5000", "+Inf"]) {
      expect(text).toContain(
        `showcase_ops_probe_duration_ms_bucket{le="${bound}"} 0`,
      );
    }
    expect(text).toMatch(/^showcase_ops_probe_duration_ms_sum 0$/m);
    expect(text).toMatch(/^showcase_ops_probe_duration_ms_count 0$/m);
  });

  it("merges `le` into existing labels for populated histograms (alphabetical sort — locked)", () => {
    const reg = createMetricsRegistry();
    reg.observe("probe_duration_ms", 5, { dimension: "smoke", key: "a" });
    const text = renderPrometheus(reg);
    // Alphabetical: dimension, key, le. This ordering is cosmetic — the
    // Prometheus parser is order-insensitive — but locked in a test so
    // dashboard templates / recording rules relying on this ordering
    // don't silently break on a sort refactor.
    expect(text).toMatch(
      /showcase_ops_probe_duration_ms_bucket\{dimension="smoke",key="a",le="10"\}\s+1/,
    );
  });

  // HF-A5: `internal_backup_failures_total` is a first-class counter —
  // distinct series from probe_runs so backup failures don't pollute the
  // probe-run dashboards. Must register in COUNTER_NAMES (typecheck
  // enforces caller correctness) and must render in the Prometheus output.
  it("exposes internal_backup_failures_total as a dedicated counter", () => {
    const reg = createMetricsRegistry();
    reg.inc("internal_backup_failures_total");
    reg.inc("internal_backup_failures_total");
    const text = renderPrometheus(reg);
    expect(text).toContain(
      "# TYPE showcase_ops_internal_backup_failures_total counter",
    );
    expect(text).toMatch(
      /^showcase_ops_internal_backup_failures_total\s+2$/m,
    );
    // Must not have leaked into probe_runs.
    expect(text).toMatch(/^showcase_ops_probe_runs 0$/m);
  });

  it("emits mixed label sets consistently across empty and populated series", () => {
    // Two histograms in one registry: one with observations, the other
    // empty (N/A today but guards against a future second histogram).
    // The populated one carries its labels; the empty-series shape must
    // not contaminate it (no stray unlabelled _sum/_count rows).
    const reg = createMetricsRegistry();
    reg.observe("probe_duration_ms", 50, { dimension: "smoke" });
    const text = renderPrometheus(reg);
    expect(text).toMatch(
      /showcase_ops_probe_duration_ms_sum\{dimension="smoke"\}\s+50/,
    );
    expect(text).not.toMatch(/^showcase_ops_probe_duration_ms_sum 0$/m);
  });
});
