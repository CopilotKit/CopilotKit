import { describe, it, expect } from "vitest";
import {
  isCatalogCandidate,
  extractComponentName,
  findFixtureFile,
} from "../component-scanner";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

describe("isCatalogCandidate", () => {
  it("returns true for file importing createCatalog", () => {
    const code = `
      import { createCatalog } from "@copilotkit/a2ui-renderer";
      export const catalog = createCatalog(defs, renderers);
    `;
    expect(isCatalogCandidate(code)).toBe(true);
  });

  it("returns true for file importing from @copilotkit/a2ui-renderer", () => {
    const code = `import { basicCatalog } from "@copilotkit/a2ui-renderer";`;
    expect(isCatalogCandidate(code)).toBe(true);
  });

  it("returns false for unrelated file", () => {
    const code = `import express from "express"; const app = express();`;
    expect(isCatalogCandidate(code)).toBe(false);
  });
});

describe("extractComponentName", () => {
  it("extracts name from filename", () => {
    expect(extractComponentName("/src/components/DataChart.tsx")).toBe(
      "DataChart",
    );
  });

  it("handles index files by using parent directory", () => {
    expect(extractComponentName("/src/components/DataChart/index.tsx")).toBe(
      "DataChart",
    );
  });
});

describe("findFixtureFile", () => {
  it("finds .fixture.json next to component", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ck-scanner-"));
    const componentPath = path.join(tmpDir, "Chart.tsx");
    const fixturePath = path.join(tmpDir, "Chart.fixture.json");
    fs.writeFileSync(componentPath, "");
    fs.writeFileSync(
      fixturePath,
      JSON.stringify({
        default: { surfaceId: "preview", messages: [] },
      }),
    );

    const result = findFixtureFile(componentPath);
    expect(result).toBe(fixturePath);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("finds .fixture.ts next to component", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ck-scanner-"));
    const componentPath = path.join(tmpDir, "Chart.tsx");
    const fixturePath = path.join(tmpDir, "Chart.fixture.ts");
    fs.writeFileSync(componentPath, "");
    fs.writeFileSync(
      fixturePath,
      'export default { default: { surfaceId: "preview", messages: [] } };',
    );

    const result = findFixtureFile(componentPath);
    expect(result).toBe(fixturePath);

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns undefined when no fixture exists", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ck-scanner-"));
    const componentPath = path.join(tmpDir, "Chart.tsx");
    fs.writeFileSync(componentPath, "");

    const result = findFixtureFile(componentPath);
    expect(result).toBeUndefined();

    fs.rmSync(tmpDir, { recursive: true });
  });
});
