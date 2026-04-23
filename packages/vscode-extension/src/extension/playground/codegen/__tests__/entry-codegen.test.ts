import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writePlaygroundSources } from "../entry-codegen";
import type { PlaygroundScanResult } from "../../types";

const scan: PlaygroundScanResult = {
  providers: [
    {
      filePath: "/tmp/test/user/src/App.tsx",
      loc: { line: 10, column: 4, endLine: 15, endColumn: 2 },
      importedName: "CopilotKitProvider",
      importSource: "@copilotkit/react-core/v2",
      props: { runtimeUrl: "/api/copilotkit" },
    },
  ],
  ancestorChain: [
    {
      tagName: "AuthProvider",
      filePath: "/tmp/test/user/src/App.tsx",
      loc: { line: 8, column: 4, endLine: 20, endColumn: 2 },
      props: {},
      importSource: "./providers/auth",
      importedName: "AuthProvider",
      isDefaultImport: false,
    },
  ],
  componentsWithHooks: [
    {
      filePath: "/tmp/test/user/src/MyPage.tsx",
      componentName: "MyPage",
      exportName: "MyPage",
      loc: { line: 1, column: 0, endLine: 10, endColumn: 1 },
      hooks: [],
    },
  ],
  hookSites: [],
  warnings: [],
};

let createdDir: string | null = null;

afterEach(() => {
  if (createdDir && fs.existsSync(createdDir)) {
    fs.rmSync(createdDir, { recursive: true, force: true });
  }
  createdDir = null;
});

describe("writePlaygroundSources", () => {
  it("writes error-boundary, aggregator, and entry files and returns the entry path", () => {
    const result = writePlaygroundSources(scan);
    createdDir = result!.outDir;

    expect(fs.existsSync(path.join(result!.outDir, "error-boundary.tsx"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(result!.outDir, "aggregator.tsx"))).toBe(
      true,
    );
    expect(fs.existsSync(result!.entryPath)).toBe(true);

    expect(path.basename(result!.entryPath)).toBe("entry.tsx");
    expect(result!.entryPath.startsWith(result!.outDir)).toBe(true);

    // Entry imports aggregator + CopilotKitProvider.
    const entrySrc = fs.readFileSync(result!.entryPath, "utf-8");
    expect(entrySrc).toContain(
      'import { HooksAggregator } from "./aggregator"',
    );
    expect(entrySrc).toContain(
      'import { CopilotKitProvider } from "@copilotkit/react-core/v2"',
    );
  });

  it("returns null when no provider is present", () => {
    const result = writePlaygroundSources({
      ...scan,
      providers: [],
      ancestorChain: undefined,
    });
    expect(result).toBeNull();
  });

  it("each call creates a fresh isolated directory", () => {
    const first = writePlaygroundSources(scan)!;
    const second = writePlaygroundSources(scan)!;
    expect(first.outDir).not.toBe(second.outDir);
    fs.rmSync(first.outDir, { recursive: true, force: true });
    fs.rmSync(second.outDir, { recursive: true, force: true });
  });

  it("forwards runtimeUrlOverride to renderEntry", () => {
    const result = writePlaygroundSources(scan, {
      runtimeUrlOverride: "http://127.0.0.1:9999",
    })!;
    createdDir = result.outDir;
    const entry = fs.readFileSync(result.entryPath, "utf-8");
    expect(entry).toContain('runtimeUrl="http://127.0.0.1:9999"');
  });
});
