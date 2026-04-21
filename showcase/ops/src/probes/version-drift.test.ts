import { describe, it, expect } from "vitest";
import Mustache from "mustache";
import { versionDriftProbe } from "./version-drift.js";
import { logger } from "../logger.js";

const ctx = { now: () => new Date("2026-04-20T00:00:00Z"), logger, env: {} };

describe("version-drift probe", () => {
  it("stable when neither drift detected", async () => {
    const r = await versionDriftProbe.run(
      { npmDriftDetected: false, pythonDriftDetected: false },
      ctx,
    );
    // Invariant: version-drift always reports green at the state-machine level
    // — the weekly template branches on signal.driftType.*.
    expect(r.state).toBe("green");
    expect(r.signal.driftType.stable).toBe(true);
    expect(r.signal.driftType.npmDrift).toBe(false);
  });

  it("flags npm-drift", async () => {
    const r = await versionDriftProbe.run(
      {
        npmDriftDetected: true,
        pythonDriftDetected: false,
        npmSummary: "4 pkgs behind",
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.driftType.npmDrift).toBe(true);
    expect(r.signal.npmSummary).toBe("4 pkgs behind");
  });

  it("flags python-drift", async () => {
    const r = await versionDriftProbe.run(
      {
        npmDriftDetected: false,
        pythonDriftDetected: true,
        pythonSummary: "2 pkgs behind",
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.driftType.pythonDrift).toBe(true);
    expect(r.signal.pythonSummary).toBe("2 pkgs behind");
  });

  it("probeErrored shadows drift flags so a registry 5xx never surfaces as drift", async () => {
    // Regression: a fetcher that reported `npmDriftDetected: true` on a 5xx
    // (because the caller conflated missing data with drift) previously fired
    // a false-positive drift alert. Now probeErrored suppresses the drift
    // flag for that side and routes through a dedicated branch.
    const r = await versionDriftProbe.run(
      {
        npmDriftDetected: true,
        pythonDriftDetected: false,
        npmProbeErrored: true,
        npmProbeErrorDesc: "npm registry 502",
      },
      ctx,
    );
    expect(r.signal.driftType.npmDrift).toBe(false);
    expect(r.signal.driftType.probeErrored).toBe(true);
    expect(r.signal.probeErrored).toBe(true);
    expect(r.signal.driftType.stable).toBe(false);
    expect(r.signal.npmProbeErrored).toBe(true);
    expect(r.signal.npmProbeErrorDesc).toBe("npm registry 502");
  });

  it("probeErrored on python side leaves npm drift flag intact", async () => {
    const r = await versionDriftProbe.run(
      {
        npmDriftDetected: true,
        pythonDriftDetected: false,
        pythonProbeErrored: true,
      },
      ctx,
    );
    expect(r.signal.driftType.npmDrift).toBe(true);
    expect(r.signal.driftType.probeErrored).toBe(true);
    expect(r.signal.pythonProbeErrored).toBe(true);
  });

  it("driftType keys are usable in Mustache section tags (no hyphens)", async () => {
    // Regression: Mustache can't look up hyphenated keys like `npm-drift` in
    // section tags. Keys MUST be camelCase so template tags render.
    const r = await versionDriftProbe.run(
      {
        npmDriftDetected: true,
        pythonDriftDetected: false,
        npmSummary: "4 pkgs behind",
      },
      ctx,
    );
    const template =
      "{{#signal.driftType.npmDrift}}NPM:{{signal.npmSummary}}{{/signal.driftType.npmDrift}}" +
      "{{#signal.driftType.pythonDrift}}PY:{{signal.pythonSummary}}{{/signal.driftType.pythonDrift}}" +
      "{{#signal.driftType.stable}}STABLE{{/signal.driftType.stable}}";
    const rendered = Mustache.render(template, { signal: r.signal });
    expect(rendered).toBe("NPM:4 pkgs behind");
  });
});
