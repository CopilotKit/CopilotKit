import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  extractCallees,
  readCatalogFile,
  readRuntimeCatalog,
  buildRuntimeEvents,
} from "../telemetry/extract";

const f = (p: string, content: string) => ({ path: p, content });

// ---------------------------------------------------------------------------
// extractCallees (docs / callee mode)
// ---------------------------------------------------------------------------

describe("extractCallees", () => {
  it("captures string-literal event names and inline object keys", () => {
    const out = extractCallees(
      [
        f(
          "a.tsx",
          `posthog.capture("try_for_free_clicked", { location: "hero", plan });`,
        ),
      ],
      { calleeNames: ["posthog.capture"], callSites: "file" },
    );
    expect(out).toEqual([
      {
        event: "try_for_free_clicked",
        call_sites: ["a.tsx"],
        properties_seen: ["location", "plan"],
      },
    ]);
  });

  it("matches the bare method name and a qualified receiver", () => {
    const src = `posthog.capture("e1", {}); telemetry.capture("e2", {});`;
    const qualified = extractCallees([f("q.ts", src)], {
      calleeNames: ["posthog.capture"],
    });
    expect(qualified.map((e) => e.event)).toEqual(["e1"]);
    const bare = extractCallees([f("q.ts", src)], { calleeNames: ["capture"] });
    expect(bare.map((e) => e.event)).toEqual(["e1", "e2"]);
  });

  it("merges, dedupes and sorts across call sites; skips non-literal keys", () => {
    const out = extractCallees(
      [
        f("x.ts", `capture("evt", { b: 1, ...rest, [dyn]: 2 });`),
        f("y.ts", `capture("evt", { a: 1 });`),
      ],
      { calleeNames: ["capture"], callSites: "file" },
    );
    expect(out).toEqual([
      {
        event: "evt",
        call_sites: ["x.ts", "y.ts"],
        properties_seen: ["a", "b"],
      },
    ]);
  });

  it("emits line-numbered sites in line mode", () => {
    const out = extractCallees([f("z.ts", `\ncapture("e", {});`)], {
      calleeNames: ["capture"],
      callSites: "line",
    });
    expect(out[0].call_sites).toEqual(["z.ts:2"]);
  });

  it("throws loudly on a parse error rather than silently under-reporting", () => {
    expect(() =>
      extractCallees([f("bad.ts", `function (`)], { calleeNames: ["capture"] }),
    ).toThrow(/Parse error in bad\.ts/);
  });
});

// ---------------------------------------------------------------------------
// readCatalogFile / readRuntimeCatalog (runtime / catalog mode)
// ---------------------------------------------------------------------------

const CATALOG = `
export type AnalyticsEvents = {
  "oss.runtime.instance_created": InstanceInfo;
  "oss.runtime.copilot_request_created": {
    requestType: string;
    "cloud.api_key_provided": boolean;
    "cloud.public_api_key"?: string;
  };
};
export interface InstanceInfo {
  actionsAmount: number;
  hashedLgcKey?: string;
  "cloud.api_key_provided": boolean;
}
`;

describe("readCatalogFile", () => {
  it("reads event names + properties from inline literals and referenced interfaces", () => {
    const cat = readCatalogFile("events.ts", CATALOG);
    expect(cat.get("oss.runtime.instance_created")).toEqual([
      "actionsAmount",
      "cloud.api_key_provided",
      "hashedLgcKey",
    ]);
    expect(cat.get("oss.runtime.copilot_request_created")).toEqual([
      "cloud.api_key_provided",
      "cloud.public_api_key",
      "requestType",
    ]);
  });

  it("throws when an event references an unknown type", () => {
    const bad = `export type AnalyticsEvents = { "x": Missing };`;
    expect(() => readCatalogFile("e.ts", bad)).toThrow(
      /references unknown type Missing/,
    );
  });

  it("throws when AnalyticsEvents is absent", () => {
    expect(() => readCatalogFile("e.ts", `export type Other = {};`)).toThrow(
      /AnalyticsEvents type map not found/,
    );
  });
});

describe("readRuntimeCatalog", () => {
  it("returns the catalog when v1 and v2 agree", () => {
    const cat = readRuntimeCatalog(f("v1.ts", CATALOG), f("v2.ts", CATALOG));
    expect([...cat.keys()].sort()).toEqual([
      "oss.runtime.copilot_request_created",
      "oss.runtime.instance_created",
    ]);
  });

  it("fails loud when v1 and v2 diverge", () => {
    const v2 = CATALOG.replace(
      "actionsAmount: number;",
      "actionsAmount: number;\n  extra?: string;",
    );
    expect(() =>
      readRuntimeCatalog(f("v1.ts", CATALOG), f("v2.ts", v2)),
    ).toThrow(/diverge/);
  });
});

describe("buildRuntimeEvents", () => {
  it("takes properties from the catalog and call sites from the scan; drops non-catalog scanned events", () => {
    const catalog = new Map([
      ["oss.runtime.instance_created", ["actionsAmount"]],
    ]);
    const events = buildRuntimeEvents(catalog, [
      f(
        "integrations/nest.ts",
        `client.capture("oss.runtime.instance_created", getInfo(opts));`,
      ),
      f("other.ts", `client.capture("something.else", { a: 1 });`),
    ]);
    expect(events).toEqual([
      {
        event: "oss.runtime.instance_created",
        call_sites: ["integrations/nest.ts"],
        properties_seen: ["actionsAmount"],
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Loose smoke test against the real runtime catalog — robust to event additions
// (asserts shape/namespace, not an exact count that would rot on every change).
// ---------------------------------------------------------------------------

describe("real runtime catalog", () => {
  const root = path.join(__dirname, "..", "..");
  const v1 = path.join(root, "packages/shared/src/telemetry/events.ts");
  const v2 = path.join(
    root,
    "packages/runtime/src/v2/runtime/telemetry/events.ts",
  );

  it("v1 parses to a non-empty oss.runtime.* catalog", () => {
    const cat = readCatalogFile(v1, fs.readFileSync(v1, "utf8"));
    expect(cat.size).toBeGreaterThan(0);
    for (const name of cat.keys())
      expect(name.startsWith("oss.runtime.")).toBe(true);
  });

  it("v1 and v2 catalogs agree (drift guard)", () => {
    expect(() =>
      readRuntimeCatalog(
        { path: v1, content: fs.readFileSync(v1, "utf8") },
        { path: v2, content: fs.readFileSync(v2, "utf8") },
      ),
    ).not.toThrow();
  });
});
