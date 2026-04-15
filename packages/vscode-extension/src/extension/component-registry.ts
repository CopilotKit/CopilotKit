import * as fs from "node:fs";
import * as path from "node:path";
import { parseSync } from "oxc-parser";

/**
 * A live registry of component names extracted from catalog files.
 * Updates when files change (HMR). Used by the fixture validator to
 * check that "component": "Foo" references a real component.
 *
 * Works like a schema registry: each catalog file produces a set of
 * valid component names from its definitions, and fixture files are
 * matched to their catalog to look up valid names.
 */
export class ComponentRegistry {
  private catalogs = new Map<string, Set<string>>();

  register(filePath: string): void {
    const names = extractDefinitionKeys(filePath);
    if (names.size > 0) {
      this.catalogs.set(normalizePath(filePath), names);
    }
  }

  unregister(filePath: string): void {
    this.catalogs.delete(normalizePath(filePath));
  }

  update(filePath: string): void {
    const norm = normalizePath(filePath);
    if (this.catalogs.has(norm)) {
      this.register(filePath);
    } else if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        if (
          content.includes("createCatalog") ||
          content.includes("@copilotkit/a2ui-renderer")
        ) {
          this.register(filePath);
        }
      } catch {
        // ignore
      }
    }
  }

  /**
   * Get all valid component names for a fixture file.
   * Finds the associated catalog and merges its definitions with
   * the basic catalog components.
   */
  getValidComponents(fixturePath: string): Set<string> | null {
    const catalogPath = findAssociatedCatalog(fixturePath);
    if (!catalogPath) return null;

    const custom = this.catalogs.get(normalizePath(catalogPath));
    if (!custom) return null;

    const all = new Set(BASIC_CATALOG_COMPONENTS);
    for (const name of custom) {
      all.add(name);
    }
    return all;
  }

  getComponents(filePath: string): Set<string> | undefined {
    return this.catalogs.get(normalizePath(filePath));
  }
}

const BASIC_CATALOG_COMPONENTS = new Set([
  "Text", "Image", "Icon", "Video", "AudioPlayer",
  "Row", "Column", "List", "Card", "Tabs",
  "Divider", "Modal", "Button", "TextField",
  "CheckBox", "ChoicePicker", "Slider", "DateTimeInput",
]);

/**
 * Extract definition keys from a catalog source file.
 * Parses with oxc-parser then scans for object keys that follow
 * the CatalogDefinitions pattern: Name: { props: ..., description: ... }
 */
function extractDefinitionKeys(filePath: string): Set<string> {
  const names = new Set<string>();

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return names;
  }

  const lang = filePath.endsWith(".tsx")
    ? ("tsx" as const)
    : filePath.endsWith(".ts")
      ? ("ts" as const)
      : ("js" as const);

  try {
    const result = parseSync(filePath, content, {
      lang,
      sourceType: "module",
    });
    if (result.errors.length > 0) return names;
  } catch {
    // Fall through to regex extraction
  }

  // Regex extraction: find object keys followed by { props: or { description:
  // This matches the standard catalog definition format
  const patterns = [
    /^\s+(\w+):\s*\{[\s\S]*?(?:description|props)\s*:/gm,
    /(\w+):\s*\{\s*(?:description|props)\s*:/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      if (name && /^[A-Z]/.test(name) && name !== "React") {
        names.add(name);
      }
    }
  }

  return names;
}

function findAssociatedCatalog(fixturePath: string): string | undefined {
  const dir = path.dirname(fixturePath);
  const basename = path.basename(fixturePath)
    .replace(".fixture.json", "")
    .replace(".fixture.ts", "")
    .replace(".fixture.tsx", "");

  const candidates = [
    path.join(dir, `${basename}.tsx`),
    path.join(dir, `${basename}.ts`),
    path.join(dir, basename, "index.tsx"),
    path.join(dir, basename, "index.ts"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}
