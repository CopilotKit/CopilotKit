import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { scanWorkspace } from "../hook-scanner";
import { bundleHookSite } from "../hook-bundler";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDir = path.resolve(__dirname, "../../../../test-workspace/hooks");

describe("hooks integration", () => {
  it("scans the fixture workspace and finds the expected hook sites", () => {
    const sites = scanWorkspace(fixturesDir);
    const hooks = sites
      .map((s) => ({ hook: s.hook, name: s.name }))
      .sort((a, b) =>
        `${a.hook}:${a.name ?? ""}`.localeCompare(`${b.hook}:${b.name ?? ""}`),
      );
    expect(hooks).toEqual([
      { hook: "useCoAgentStateRender", name: "forecast_agent" },
      { hook: "useComponent", name: "sunTimes" },
      { hook: "useCopilotAction", name: "addLocation" },
      { hook: "useCopilotAction", name: "removeLocation" },
      { hook: "useCopilotAction", name: "severeAlert" },
      { hook: "useCopilotAction", name: "showAirQuality" },
      { hook: "useCopilotAuthenticatedAction_c", name: "publishAlert" },
      { hook: "useDefaultRenderTool", name: "defaultWeatherFallback" },
      { hook: "useDefaultTool", name: null },
      { hook: "useFrontendTool", name: "precipitationGauge" },
      { hook: "useHumanInTheLoop", name: "confirmEvacuation" },
      { hook: "useInterrupt", name: null },
      { hook: "useLangGraphInterrupt", name: null },
      { hook: "useLazyToolRenderer", name: "historicalTemperatures" },
      { hook: "useRenderActivityMessage", name: null },
      { hook: "useRenderCustomMessages", name: null },
      { hook: "useRenderTool", name: "getWeather" },
      { hook: "useRenderTool", name: "pollenReport" },
      { hook: "useRenderToolCall", name: "viewRadar" },
    ]);
  });

  it("bundles every fixture file without error", async () => {
    for (const fx of [
      "AdminIssueAlert.tsx",
      "ConfirmEvacuation.tsx",
      "DefaultWeatherCatchAll.tsx",
      "DefaultWeatherRender.tsx",
      "ForecastAgent.tsx",
      "ImportedAirQuality.tsx",
      "ImportedPollenReport.tsx",
      "LazyHistoricalChart.tsx",
      "LocationPermissionInterrupt.tsx",
      "PrecipGaugeFrontendTool.tsx",
      "SevereWeatherAlert.tsx",
      "UnitsPreferenceInterrupt.tsx",
      "WeatherActions.tsx",
      "WeatherActivityMessage.tsx",
      "WeatherComponent.tsx",
      "WeatherCustomMessage.tsx",
      "WeatherRadar.tsx",
      "WeatherTool.tsx",
    ]) {
      const result = await bundleHookSite(path.join(fixturesDir, fx));
      expect(result.success, fx ? `${fx}: ${result.error}` : undefined).toBe(
        true,
      );
      expect(result.code, fx).toBeTruthy();
    }
  }, 60_000);

  it("collects CSS imports into the bundle result's css field", async () => {
    const result = await bundleHookSite(
      path.join(fixturesDir, "SevereWeatherAlert.tsx"),
    );
    expect(result.success).toBe(true);
    expect(result.css).toBeDefined();
    expect(result.css).toContain("cpk-alert");
    expect(result.css).toContain("cpk-alert-warning");
  }, 60_000);

  it("does not externalize Node builtins (guard against 'node_path is not defined')", async () => {
    // Regression guard: the IIFE bundler must not emit
    //   var node_path = node_path;
    // (or any other `node_<builtin>` self-reference) — that pattern throws
    // 'node_path is not defined' in the webview the moment the bundle runs.
    const result = await bundleHookSite(
      path.join(fixturesDir, "WeatherActions.tsx"),
    );
    expect(result.success).toBe(true);
    const code = result.code!;
    // Match rolldown's self-assign externalization output for any
    // identifier starting with `node_`.
    const selfAssigns = [...code.matchAll(/var (node_\w+) = \1;/g)].map(
      (m) => m[1],
    );
    expect(selfAssigns).toEqual([]);
    // Every reference to a Node-builtin-shaped identifier (`node_path`,
    // `node_fs`, `node_crypto`, …) must have a declaration earlier. Use
    // the `isBuiltin`-style list directly so we don't match unrelated
    // identifiers that happen to start with `node_`.
    const BUILTIN_NAMES = [
      "path",
      "fs",
      "crypto",
      "stream",
      "url",
      "util",
      "events",
      "buffer",
      "http",
      "https",
      "zlib",
      "os",
      "assert",
      "net",
      "tls",
      "querystring",
      "child_process",
      "worker_threads",
    ];
    for (const name of BUILTIN_NAMES) {
      const ident = `node_${name}`;
      const used = new RegExp(`\\b${ident}\\b`).test(code);
      if (!used) continue;
      const declared = new RegExp(
        `(?:var|let|const|import[^;]*\\bas)\\s+${ident}\\b`,
      ).test(code);
      expect(declared, `${ident} used but never declared`).toBe(true);
    }
  }, 60_000);
});
