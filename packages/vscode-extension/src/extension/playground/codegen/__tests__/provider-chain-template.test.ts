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
    importSource: "./providers/auth",
    importedName: "AuthProvider",
    isDefaultImport: false,
  },
  {
    tagName: "ThemeProvider",
    filePath: "/tmp/test/user/src/App.tsx",
    loc: { line: 8, column: 4, endLine: 19, endColumn: 2 },
    props: { mode: "dark" },
    importSource: "./providers/theme",
    importedName: "ThemeProvider",
    isDefaultImport: false,
  },
];

describe("renderEntry", () => {
  it("imports each ancestor from its real import source", () => {
    const code = renderEntry({
      provider,
      ancestors,
      aggregatorModule: "./aggregator",
      outDir: "/tmp/test/out",
    });
    expect(code).toContain(
      'import { AuthProvider } from "../user/src/providers/auth"',
    );
    expect(code).toContain(
      'import { ThemeProvider } from "../user/src/providers/theme"',
    );
    expect(code).toContain(
      'import { CopilotKitProvider } from "@copilotkit/react-core/v2"',
    );
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
    const res = parseSync("entry.tsx", code, {
      lang: "tsx",
      sourceType: "module",
    });
    expect(res.errors).toEqual([]);
  });

  it("skips ancestors with null importSource and emits a comment", () => {
    const localAncestor: ProviderChainEntry = {
      tagName: "LocalHelper",
      filePath: "/tmp/test/user/src/App.tsx",
      loc: { line: 5, column: 0, endLine: 20, endColumn: 0 },
      props: {},
      importSource: null,
      importedName: null,
      isDefaultImport: false,
    };
    const code = renderEntry({
      provider,
      ancestors: [localAncestor],
      aggregatorModule: "./aggregator",
      outDir: "/tmp/test/out",
    });
    expect(code).toContain("skipped ancestor: LocalHelper");
    // No import statement for LocalHelper — can't resolve it.
    expect(code).not.toMatch(/import .* LocalHelper/);
    // The JSX inside PlaygroundEntry does NOT wrap in <LocalHelper>.
    expect(code).not.toMatch(/<LocalHelper/);
  });

  it("emits default import when isDefaultImport is true", () => {
    const layoutAncestor: ProviderChainEntry = {
      tagName: "Layout",
      filePath: "/tmp/test/user/src/App.tsx",
      loc: { line: 5, column: 0, endLine: 20, endColumn: 0 },
      props: {},
      importSource: "./layout",
      importedName: "default",
      isDefaultImport: true,
    };
    const code = renderEntry({
      provider,
      ancestors: [layoutAncestor],
      aggregatorModule: "./aggregator",
      outDir: "/tmp/test/out",
    });
    expect(code).toContain('import Layout from "../user/src/layout"');
  });

  it("reproduces the alias when importedName differs from tagName", () => {
    const themeAncestor: ProviderChainEntry = {
      tagName: "Theme",
      filePath: "/tmp/test/user/src/App.tsx",
      loc: { line: 5, column: 0, endLine: 20, endColumn: 0 },
      props: { mode: "dark" },
      importSource: "./providers/theme",
      importedName: "ThemeProvider",
      isDefaultImport: false,
    };
    const code = renderEntry({
      provider,
      ancestors: [themeAncestor],
      aggregatorModule: "./aggregator",
      outDir: "/tmp/test/out",
    });
    expect(code).toContain(
      'import { ThemeProvider as Theme } from "../user/src/providers/theme"',
    );
    expect(code).toContain('<Theme mode="dark">');
  });

  it("overrides runtimeUrl when runtimeUrlOverride is provided", () => {
    const code = renderEntry({
      provider,
      ancestors: [],
      aggregatorModule: "./aggregator",
      outDir: "/tmp/test/out",
      runtimeUrlOverride: "http://127.0.0.1:54321",
    });
    expect(code).toContain('runtimeUrl="http://127.0.0.1:54321"');
    // The user's original runtimeUrl must not appear.
    expect(code).not.toContain('"/api/copilotkit"');
  });

  it("preserves other provider props when overriding runtimeUrl", () => {
    const code = renderEntry({
      provider,
      ancestors: [],
      aggregatorModule: "./aggregator",
      outDir: "/tmp/test/out",
      runtimeUrlOverride: "http://127.0.0.1:54321",
    });
    // publicApiKey and other props from the existing `provider` fixture still appear.
    expect(code).toContain('publicApiKey="pk_test"');
  });
});
