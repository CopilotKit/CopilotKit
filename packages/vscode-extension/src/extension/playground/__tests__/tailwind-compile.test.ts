import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compileTailwindForBundle,
  detectTailwindEntryCss,
} from "../tailwind-compile";

const tempDirs: string[] = [];

function makeTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "playground-tailwind-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("detectTailwindEntryCss", () => {
  it("returns null when no CSS entry is present", () => {
    const root = makeTempWorkspace();
    expect(detectTailwindEntryCss(root)).toBeNull();
  });

  it("finds src/app/globals.css with v4 @import directive", () => {
    const root = makeTempWorkspace();
    const cssDir = path.join(root, "src", "app");
    fs.mkdirSync(cssDir, { recursive: true });
    const cssPath = path.join(cssDir, "globals.css");
    fs.writeFileSync(cssPath, '@import "tailwindcss";\n');

    expect(detectTailwindEntryCss(root)).toBe(cssPath);
  });

  it("finds src/index.css with v3 @tailwind base directive", () => {
    const root = makeTempWorkspace();
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const cssPath = path.join(root, "src", "index.css");
    fs.writeFileSync(cssPath, "@tailwind base;\n@tailwind utilities;\n");

    expect(detectTailwindEntryCss(root)).toBe(cssPath);
  });

  it("ignores CSS files without a Tailwind directive", () => {
    const root = makeTempWorkspace();
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src", "index.css"),
      "body { margin: 0; }",
    );
    expect(detectTailwindEntryCss(root)).toBeNull();
  });

  it("respects an explicit override path", () => {
    const root = makeTempWorkspace();
    const customPath = path.join(root, "weird-name.css");
    fs.writeFileSync(customPath, '@import "tailwindcss";');
    expect(detectTailwindEntryCss(root, customPath)).toBe(customPath);
  });
});

describe("compileTailwindForBundle", () => {
  it("returns skipped reason when no CSS entry exists", async () => {
    const root = makeTempWorkspace();
    const result = await compileTailwindForBundle({
      workspaceRoot: root,
      bundledJs: "var x = 1;",
      log: () => {},
    });

    expect(result.css).toBeUndefined();
    expect(result.skipped).toMatch(/no entry CSS/);
  });

  it("compiles utility classes from the bundled JS source", async () => {
    const root = makeTempWorkspace();
    fs.mkdirSync(path.join(root, "src", "app"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src", "app", "globals.css"),
      '@import "tailwindcss";\n',
    );

    // Bundle text contains a few utility classes — compile() should emit
    // matching CSS rules for them and skip everything else.
    const bundledJs = `
      const className = "rounded-2xl bg-gradient-to-br p-5 text-white";
      const other = "text-3xl font-bold";
    `;

    const result = await compileTailwindForBundle({
      workspaceRoot: root,
      bundledJs,
      log: () => {},
    });

    expect(result.error, result.error).toBeUndefined();
    expect(result.skipped).toBeUndefined();
    expect(result.css).toBeDefined();
    expect(result.css).toMatch(/\.rounded-2xl/);
    expect(result.css).toMatch(/\.bg-gradient-to-br/);
    expect(result.css).toMatch(/\.text-white/);
  }, 15000);
});
