// @vitest-environment node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "testing" || entry.name === "__tests__") return [];
      return productionTypeScriptFiles(path);
    }
    if (!entry.name.endsWith(".ts")) return [];
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts")) {
      return [];
    }
    return statSync(path).isFile() ? [path] : [];
  });
}

describe("web inspector package architecture", () => {
  it("prevents domains from importing other domains", () => {
    const domainsRoot = normalize(resolve(sourceRoot, "domains"));
    const violations = productionTypeScriptFiles(domainsRoot).flatMap(
      (path) => {
        const owner = relative(domainsRoot, path).split(sep)[0];
        const source = readFileSync(path, "utf8");
        return [...source.matchAll(/from\s+["']([^"']+)["']/g)].flatMap(
          (match) => {
            const specifier = match[1];
            if (!specifier?.startsWith(".")) return [];
            const target = normalize(resolve(dirname(path), specifier));
            const targetRelativePath = relative(domainsRoot, target);
            if (targetRelativePath.startsWith("..")) return [];
            const importedDomain = targetRelativePath.split(sep)[0];
            return importedDomain && importedDomain !== owner
              ? [`${path} -> ${importedDomain}`]
              : [];
          },
        );
      },
    );

    expect(violations).toEqual([]);
  });

  it.each(["shared", "ui"])("prevents %s from importing domains", (layer) => {
    const violations = productionTypeScriptFiles(
      resolve(sourceRoot, layer),
    ).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return [...source.matchAll(/from\s+["']([^"']+)["']/g)]
        .map((match) => match[1])
        .filter((specifier) => specifier?.includes("/domains/"))
        .map((specifier) => `${path} -> ${specifier}`);
    });

    expect(violations).toEqual([]);
  });
});
