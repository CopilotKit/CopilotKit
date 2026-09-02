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
  it("keeps production source in the approved package layers", () => {
    const approvedEntries = [
      "__tests__",
      "assets",
      "domains",
      "index.ts",
      "register.ts",
      "shared",
      "shell",
      "styles",
      "testing",
      "ui",
    ];
    const actualEntries = readdirSync(sourceRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.name.endsWith(".ts"))
      .map((entry) => entry.name)
      .sort();

    expect(actualEntries).toEqual(approvedEntries);
  });

  it("keeps package-entry auto-registration", () => {
    const source = readFileSync(resolve(sourceRoot, "index.ts"), "utf8");

    expect(source).toMatch(
      /import\s+\{\s*defineWebInspector\s*\}\s+from\s+["']\.\/register\.js["']/,
    );
    expect(source).toMatch(/defineWebInspector\(\);/);
  });

  it("keeps production modules within the reviewable size ceiling", () => {
    const lifecycleCoordinator = normalize(
      resolve(sourceRoot, "shell/web-inspector-element.ts"),
    );
    const oversized = productionTypeScriptFiles(sourceRoot)
      // The root preserves Lit lifecycle and requestUpdate ordering while
      // delegating domain, launcher, navigation, settings, and window work.
      .filter((path) => normalize(path) !== lifecycleCoordinator)
      .flatMap((path) => {
        const lines = readFileSync(path, "utf8")
          .trimEnd()
          .split(/\r?\n/).length;
        return lines > 800 ? [`${relative(sourceRoot, path)} (${lines})`] : [];
      });

    expect(oversized).toEqual([]);
  });

  it("prevents domains from importing other domains", () => {
    const domainsRoot = normalize(resolve(sourceRoot, "domains"));
    const violations = productionTypeScriptFiles(domainsRoot).flatMap(
      (path) => {
        const owner = relative(domainsRoot, path).split(sep)[0] ?? "";
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

  it("limits domain dependencies to shared and UI modules", () => {
    const domainsRoot = normalize(resolve(sourceRoot, "domains"));
    const allowedRoots = [
      normalize(resolve(sourceRoot, "shared")),
      normalize(resolve(sourceRoot, "ui")),
    ];
    const violations = productionTypeScriptFiles(domainsRoot).flatMap(
      (path) => {
        const owner = relative(domainsRoot, path).split(sep)[0] ?? "";
        const ownerRoot = normalize(resolve(domainsRoot, owner));
        const source = readFileSync(path, "utf8");
        return [...source.matchAll(/from\s+["']([^"']+)["']/g)].flatMap(
          (match) => {
            const specifier = match[1];
            if (!specifier?.startsWith(".")) return [];
            const target = normalize(resolve(dirname(path), specifier));
            const isAllowed = [ownerRoot, ...allowedRoots].some(
              (root) => target === root || target.startsWith(`${root}${sep}`),
            );
            return isAllowed ? [] : [`${path} -> ${specifier}`];
          },
        );
      },
    );

    expect(violations).toEqual([]);
  });

  it("keeps production code out of test helpers", () => {
    const testingRoot = normalize(resolve(sourceRoot, "testing"));
    const violations = productionTypeScriptFiles(sourceRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return [...source.matchAll(/from\s+["']([^"']+)["']/g)].flatMap(
        (match) => {
          const specifier = match[1];
          if (!specifier?.startsWith(".")) return [];
          const target = normalize(resolve(dirname(path), specifier));
          return target === testingRoot ||
            target.startsWith(`${testingRoot}${sep}`)
            ? [`${path} -> ${specifier}`]
            : [];
        },
      );
    });

    expect(violations).toEqual([]);
  });

  it("allows raw telemetry transport access only through the privacy layer", () => {
    const privacyModule = normalize(
      resolve(sourceRoot, "shared/telemetry/privacy.ts"),
    );
    const transportModule = normalize(
      resolve(sourceRoot, "shared/telemetry/transport.js"),
    );
    const violations = productionTypeScriptFiles(sourceRoot)
      .filter((path) => normalize(path) !== privacyModule)
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return [...source.matchAll(/from\s+["']([^"']+)["']/g)].flatMap(
          (match) => {
            const specifier = match[1];
            if (!specifier?.startsWith(".")) return [];
            const target = normalize(resolve(dirname(path), specifier));
            return target === transportModule
              ? [`${path} -> ${specifier}`]
              : [];
          },
        );
      });

    expect(violations).toEqual([]);
  });

  it.each(["shared", "ui"])(
    "prevents %s from importing domains or shell",
    (layer) => {
      const violations = productionTypeScriptFiles(
        resolve(sourceRoot, layer),
      ).flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return [...source.matchAll(/from\s+["']([^"']+)["']/g)]
          .map((match) => match[1])
          .filter(
            (specifier) =>
              specifier?.includes("/domains/") ||
              specifier?.includes("/shell/"),
          )
          .map((specifier) => `${path} -> ${specifier}`);
      });

      expect(violations).toEqual([]);
    },
  );
});
