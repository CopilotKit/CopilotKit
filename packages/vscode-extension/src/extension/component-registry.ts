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
/** Component name -> set of known prop keys */
export type ComponentSchema = Map<string, Set<string>>;

export class ComponentRegistry {
  /** catalogFilePath -> ComponentSchema (name -> props) */
  private catalogs = new Map<string, ComponentSchema>();

  register(filePath: string): void {
    const schema = extractComponentSchema(filePath);
    if (schema.size > 0) {
      this.catalogs.set(normalizePath(filePath), schema);
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
   */
  getValidComponents(fixturePath: string): Set<string> | null {
    const catalogPath = findAssociatedCatalog(fixturePath);
    if (!catalogPath) return null;

    const custom = this.catalogs.get(normalizePath(catalogPath));
    if (!custom) return null;

    const all = new Set<string>([...BASIC_CATALOG_COMPONENTS.keys()]);
    for (const name of custom.keys()) {
      all.add(name);
    }
    return all;
  }

  /**
   * Get known prop keys for a specific component type.
   * Merges basic catalog props with custom catalog props.
   */
  getComponentProps(
    fixturePath: string,
    componentType: string,
  ): Set<string> | null {
    // Check basic catalog first
    const basicProps = BASIC_CATALOG_COMPONENTS.get(componentType);

    // Check custom catalog
    const catalogPath = findAssociatedCatalog(fixturePath);
    let customProps: Set<string> | undefined;
    if (catalogPath) {
      const schema = this.catalogs.get(normalizePath(catalogPath));
      customProps = schema?.get(componentType);
    }

    if (!basicProps && !customProps) return null;

    const all = new Set<string>();
    if (basicProps) for (const p of basicProps) all.add(p);
    if (customProps) for (const p of customProps) all.add(p);
    return all;
  }

  getComponents(filePath: string): Set<string> | undefined {
    const schema = this.catalogs.get(normalizePath(filePath));
    return schema ? new Set(schema.keys()) : undefined;
  }

  /**
   * Update the registry with the real schema extracted from the loaded catalog
   * in the webview (via extractCatalogComponentSchemas which uses zod-to-json-schema).
   * This replaces the regex-extracted schema with the authoritative one.
   */
  updateFromCatalogSchema(
    fixturePath: string,
    entries: Array<{ name: string; props: Record<string, unknown> }>,
  ): void {
    const catalogPath = findAssociatedCatalog(fixturePath);
    const key = catalogPath ? normalizePath(catalogPath) : `__live_schema__`;

    const schema: ComponentSchema = new Map();
    for (const entry of entries) {
      const propKeys = extractPropKeysFromJsonSchema(entry.props);
      schema.set(entry.name, propKeys);
    }

    if (schema.size > 0) {
      this.catalogs.set(key, schema);
    }
  }
}

/** Basic catalog components with their known prop keys. */
const BASIC_CATALOG_COMPONENTS = new Map<string, Set<string>>([
  ["Text", new Set(["text", "style", "weight"])],
  ["Image", new Set(["src", "alt", "width", "height"])],
  ["Icon", new Set(["name", "size", "color"])],
  ["Video", new Set(["src", "poster", "autoplay"])],
  ["AudioPlayer", new Set(["src", "title"])],
  ["Row", new Set(["children", "gap", "align", "justify"])],
  ["Column", new Set(["children", "gap", "align"])],
  ["List", new Set(["children", "ordered"])],
  ["Card", new Set(["children", "title", "subtitle", "child"])],
  ["Tabs", new Set(["children", "tabs"])],
  ["Divider", new Set([])],
  ["Modal", new Set(["children", "title", "open", "child"])],
  ["Button", new Set(["child", "variant", "action"])],
  ["TextField", new Set(["label", "placeholder", "value"])],
  ["CheckBox", new Set(["label", "checked"])],
  ["ChoicePicker", new Set(["label", "options", "value"])],
  ["Slider", new Set(["label", "min", "max", "value", "step"])],
  ["DateTimeInput", new Set(["label", "value", "type"])],
]);

/**
 * Extract component definitions (names + prop keys) from a catalog source file.
 * Parses with oxc-parser for validation, then uses regex to extract:
 * - Component names (PascalCase keys with `props:` or `description:`)
 * - Prop keys from z.object({ key: ... }) patterns
 */
function extractComponentSchema(filePath: string): ComponentSchema {
  const schema: ComponentSchema = new Map();

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return schema;
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
    if (result.errors.length > 0) return schema;
  } catch {
    // Fall through to regex extraction
  }

  // Find component definitions: Name: { ... props: z.object({ ... }) ... }
  // We extract the component name AND the prop keys from z.object
  const componentBlockPattern =
    /(\w+):\s*\{[^}]*?props:\s*z\.object\(\{([\s\S]*?)\}\)/g;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = componentBlockPattern.exec(content)) !== null) {
    const name = blockMatch[1];
    if (!name || !/^[A-Z]/.test(name) || name === "React") continue;

    const propsBlock = blockMatch[2];
    const propKeys = new Set<string>();

    // Extract keys from inside z.object({ key: z.xxx(), ... })
    const propKeyPattern = /(\w+)\s*:/g;
    let propMatch: RegExpExecArray | null;
    while ((propMatch = propKeyPattern.exec(propsBlock)) !== null) {
      const key = propMatch[1];
      // Filter out z.xxx method names and common non-prop words
      if (key && !key.startsWith("z") && key !== "description") {
        propKeys.add(key);
      }
    }

    schema.set(name, propKeys);
  }

  // Fallback: if the z.object regex didn't match, at least get the names
  if (schema.size === 0) {
    const simplePattern = /(\w+):\s*\{\s*(?:description|props)\s*:/g;
    let match: RegExpExecArray | null;
    while ((match = simplePattern.exec(content)) !== null) {
      const name = match[1];
      if (name && /^[A-Z]/.test(name) && name !== "React") {
        schema.set(name, new Set());
      }
    }
  }

  return schema;
}

function findAssociatedCatalog(fixturePath: string): string | undefined {
  const dir = path.dirname(fixturePath);
  const basename = path
    .basename(fixturePath)
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

/**
 * Extract prop keys from a JSON Schema object (from zod-to-json-schema).
 * Handles standard JSON Schema shapes: { properties: { key: ... } }
 */
function extractPropKeysFromJsonSchema(
  schema: Record<string, unknown>,
): Set<string> {
  const keys = new Set<string>();

  // Standard JSON Schema: { type: "object", properties: { ... } }
  const props = schema.properties as Record<string, unknown> | undefined;
  if (props && typeof props === "object") {
    for (const key of Object.keys(props)) {
      keys.add(key);
    }
  }

  // Sometimes wrapped in allOf/anyOf/oneOf
  for (const wrapper of ["allOf", "anyOf", "oneOf"] as const) {
    const arr = schema[wrapper] as unknown[] | undefined;
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && typeof item === "object") {
          const nested = extractPropKeysFromJsonSchema(
            item as Record<string, unknown>,
          );
          for (const k of nested) keys.add(k);
        }
      }
    }
  }

  return keys;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}
