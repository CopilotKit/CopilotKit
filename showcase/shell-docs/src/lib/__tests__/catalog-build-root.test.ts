import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import nextConfig from "../../../next.config";

it("keeps shared catalog imports inside the standalone docs build root", () => {
  const packageDir = path.resolve(__dirname, "../../..");
  // In Docker there is no parent monorepo lockfile to widen the inferred root.
  const buildRoot = nextConfig.turbopack?.root ?? packageDir;
  const entry = path.join(
    packageDir,
    "src/components/standard-catalog/catalog-data.ts",
  );
  const imports = [
    ...new Set(
      [
        ...fs
          .readFileSync(entry, "utf8")
          .matchAll(/from\s+["'](\.\.[^"']+)["']/g),
      ].map((match) => match[1]),
    ),
  ];
  expect(imports.length).toBeGreaterThan(0);
  for (const specifier of imports) {
    const source = path.resolve(path.dirname(entry), `${specifier}.ts`);
    expect(fs.existsSync(source), specifier).toBe(true);
    const relativePath = path.relative(buildRoot, source);
    expect(path.isAbsolute(relativePath), specifier).toBe(false);
    expect(relativePath.split(path.sep)[0], specifier).not.toBe("..");
  }
});
