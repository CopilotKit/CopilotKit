import { describe, expect, it } from "vitest";
import { parseSync } from "oxc-parser";
import { renderEntry } from "../provider-chain-template";
import type {
  CopilotKitProviderLocation,
  ProviderChainEntry,
} from "../../types";

const provider: CopilotKitProviderLocation = {
  filePath: "/tmp/test/user/src/App.tsx",
  loc: { line: 10, column: 4, endLine: 15, endColumn: 2 },
  importedName: "CopilotKitProvider",
  importSource: "@copilotkit/react-core/v2",
  props: {
    runtimeUrl: "/api/copilotkit",
    publicApiKey: "pk_test",
    properties: { tenant: "acme", nested: { x: 1 } },
    onError: {
      __unserializable: true,
      reason: "inline function",
      source: "(err) => console.error(err)",
      loc: { line: 13, column: 10, endLine: 13, endColumn: 40 },
    },
  },
};

const ancestors: ProviderChainEntry[] = [
  {
    tagName: "AuthProvider",
    filePath: "/tmp/test/user/src/App.tsx",
    loc: { line: 7, column: 4, endLine: 20, endColumn: 2 },
    props: {},
  },
  {
    tagName: "ThemeProvider",
    filePath: "/tmp/test/user/src/App.tsx",
    loc: { line: 8, column: 4, endLine: 19, endColumn: 2 },
    props: { mode: "dark" },
  },
];

describe("renderEntry", () => {
  it("imports ancestors from the same-file source", () => {
    const code = renderEntry({
      provider,
      ancestors,
      aggregatorModule: "./aggregator",
      outDir: "/tmp/test/out",
    });
    expect(code).toContain('import { AuthProvider, ThemeProvider } from "../user/src/App"');
    expect(code).toContain('import { CopilotKitProvider } from "@copilotkit/react-core/v2"');
    expect(code).toContain('import { HooksAggregator } from "./aggregator"');
  });

  it("rebuilds the provider chain outermost-first", () => {
    const code = renderEntry({
      provider,
      ancestors,
      aggregatorModule: "./aggregator",
      outDir: "/tmp/test/out",
    });
    // The chain must nest AuthProvider > ThemeProvider > CopilotKitProvider.
    const a = code.indexOf("<AuthProvider");
    const t = code.indexOf("<ThemeProvider");
    const c = code.indexOf("<CopilotKitProvider");
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(t);
    expect(t).toBeLessThan(c);
  });

  it("serializes primitives inline and inlines unserializable source verbatim", () => {
    const code = renderEntry({
      provider,
      ancestors,
      aggregatorModule: "./aggregator",
      outDir: "/tmp/test/out",
    });
    expect(code).toContain('runtimeUrl="/api/copilotkit"');
    expect(code).toContain('publicApiKey="pk_test"');
    expect(code).toContain('properties={{"tenant":"acme","nested":{"x":1}}}');
    // Inline function must be inlined verbatim in braces.
    expect(code).toContain("onError={(err) => console.error(err)}");
    // ThemeProvider prop rendered inline.
    expect(code).toContain('mode="dark"');
  });

  it("produces parseable TSX", () => {
    const code = renderEntry({
      provider,
      ancestors,
      aggregatorModule: "./aggregator",
      outDir: "/tmp/test/out",
    });
    const res = parseSync("entry.tsx", code, { lang: "tsx", sourceType: "module" });
    expect(res.errors).toEqual([]);
  });
});
