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
});
