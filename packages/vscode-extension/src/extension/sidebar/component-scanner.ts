import * as fs from "node:fs";
import * as path from "node:path";
import { parseSync } from "oxc-parser";
import type { DiscoveredComponent } from "../types";
import { parseFixtureJson } from "../fixture-validator";

const CATALOG_INDICATORS = [
  "@copilotkit/a2ui-renderer",
  "createCatalog",
  "createA2UICatalog",
];

export function isCatalogCandidate(content: string): boolean {
  return CATALOG_INDICATORS.some((indicator) => content.includes(indicator));
}

export function extractComponentName(filePath: string): string {
  const basename = path.basename(filePath, path.extname(filePath));
  if (basename === "index") {
    return path.basename(path.dirname(filePath));
  }
  return basename;
}

export function findFixtureFile(componentPath: string): string | undefined {
  const dir = path.dirname(componentPath);
  const basename = path.basename(componentPath, path.extname(componentPath));
  const name = basename === "index" ? path.basename(dir) : basename;
  const searchDir = basename === "index" ? path.dirname(dir) : dir;

  const extensions = [".fixture.json", ".fixture.ts", ".fixture.tsx"];
  for (const ext of extensions) {
    const fixturePath = path.join(searchDir, `${name}${ext}`);
    if (fs.existsSync(fixturePath)) {
      return fixturePath;
    }
  }
  if (basename === "index") {
    for (const ext of extensions) {
      const fixturePath = path.join(dir, `${name}${ext}`);
      if (fs.existsSync(fixturePath)) {
        return fixturePath;
      }
    }
  }
  return undefined;
}

export function getFixtureNames(fixturePath: string): string[] {
  const content = fs.readFileSync(fixturePath, "utf-8");

  if (fixturePath.endsWith(".json")) {
    const result = parseFixtureJson(content);
    if (result.valid && result.fixtures) {
      return Object.keys(result.fixtures);
    }
    return [];
  }

  try {
    const result = parseSync(fixturePath, content, {
      lang: fixturePath.endsWith(".tsx") ? "tsx" : "ts",
      sourceType: "module",
    });
    if (result.errors.length > 0) return [];

    const keyPattern = /["']([^"']+)["']\s*:/g;
    const keys: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = keyPattern.exec(content)) !== null) {
      if (match[1] && !["surfaceId", "messages"].includes(match[1])) {
        keys.push(match[1]);
      }
    }
    return keys;
  } catch {
    return [];
  }
}

export function confirmCatalogExport(
  filePath: string,
  content: string,
): boolean {
  try {
    const lang = filePath.endsWith(".tsx")
      ? "tsx"
      : filePath.endsWith(".ts")
        ? "ts"
        : "js";
    const result = parseSync(filePath, content, { lang, sourceType: "module" });
    if (result.errors.length > 0) return false;
    return result.module.staticExports.length > 0;
  } catch {
    return false;
  }
}

export function scanDirectory(
  rootDir: string,
  excludePatterns: string[] = ["node_modules", "dist", ".git", ".next"],
): DiscoveredComponent[] {
  const components: DiscoveredComponent[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (excludePatterns.some((p) => entry.name === p)) continue;
        walk(fullPath);
        continue;
      }

      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      if (entry.name.includes(".fixture.")) continue;
      if (entry.name.includes(".test.") || entry.name.includes(".spec."))
        continue;

      let content: string;
      try {
        content = fs.readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }

      if (!isCatalogCandidate(content)) continue;
      if (!confirmCatalogExport(fullPath, content)) continue;

      const fixturePath = findFixtureFile(fullPath);
      const fixtureNames = fixturePath
        ? getFixtureNames(fixturePath)
        : undefined;

      components.push({
        name: extractComponentName(fullPath),
        filePath: fullPath,
        fixturePath,
        fixtureNames,
      });
    }
  }

  walk(rootDir);
  return components;
}
