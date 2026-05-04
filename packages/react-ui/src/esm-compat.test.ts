import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Validates that packages with "type": "module" don't ship .js files using
 * CommonJS syntax (require/module.exports). Consumers' build tools (e.g.
 * postcss-loader) may discover these config files and fail because Node
 * treats .js as ESM in "type": "module" packages.
 *
 * Fix: rename CJS files to .cjs so Node always treats them as CommonJS.
 */
describe("ESM compatibility", () => {
  const pkgRoot = path.resolve(__dirname, "..");
  const pkg = JSON.parse(
    fs.readFileSync(path.join(pkgRoot, "package.json"), "utf-8"),
  );

  it('should not have .js config files with CJS syntax when package uses "type": "module"', () => {
    if (pkg.type !== "module") return;

    const jsFiles = fs
      .readdirSync(pkgRoot)
      .filter((f) => f.endsWith(".config.js") || f === ".postcssrc.js");

    const cjsFiles: string[] = [];
    for (const file of jsFiles) {
      const content = fs.readFileSync(path.join(pkgRoot, file), "utf-8");
      if (content.includes("require(") || content.includes("module.exports")) {
        cjsFiles.push(file);
      }
    }

    expect(cjsFiles).toEqual(expect.arrayContaining([]));
    expect(cjsFiles).toHaveLength(0);
    if (cjsFiles.length > 0) {
      throw new Error(
        `These files use CommonJS syntax but will be treated as ESM because ` +
          `package.json has "type": "module". Rename them to .cjs:\n` +
          cjsFiles.map((f) => `  - ${f}`).join("\n"),
      );
    }
  });
});
