// Every subpath that a published app-facing package exports must also be in
// its `typesVersions`. TypeScript with `"moduleResolution": "node"` (node10)
// reads no `exports` map, so without the entry an app on that setting cannot
// resolve `@copilotkit/runtime/agent` and the like, and the package's own
// declarations that import a sibling subpath fail to type-check.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

/** The packages apps install directly or through another 2.0 package. */
const PACKAGES = [
  "shared",
  "core",
  "runtime",
  "react-core",
  "react-native",
  "markdown",
  "mcp-apps-renderer",
  "web-components",
  "web-inspector",
  "sdk-js",
  "vue",
];

type ExportTarget =
  | string
  | {
      require?: ExportTarget;
      import?: ExportTarget;
      types?: string;
      default?: string;
    };

/** The CommonJS declaration file an export resolves to, the one node10 uses. */
function declarationOf(target: ExportTarget): string | undefined {
  if (typeof target === "string") {
    return /\.d\.c?ts$/.test(target)
      ? target
      : target.replace(/\.c?js$/, ".d.cts");
  }
  if (target.require) return declarationOf(target.require);
  if (target.types) return target.types;
  if (target.default) return declarationOf(target.default);
  if (target.import) return declarationOf(target.import);
  return undefined;
}

describe("typesVersions covers every exported subpath", () => {
  for (const name of PACKAGES) {
    it(`@copilotkit/${name}`, () => {
      const manifest = JSON.parse(
        readFileSync(path.join(root, "packages", name, "package.json"), "utf8"),
      ) as {
        exports?: Record<string, ExportTarget>;
        typesVersions?: Record<string, Record<string, string[]>>;
      };
      const mapped = manifest.typesVersions?.["*"] ?? {};
      const expected: Record<string, string[]> = {};
      for (const [key, target] of Object.entries(manifest.exports ?? {})) {
        if (key === "." || key === "./package.json" || key.endsWith(".css")) {
          continue;
        }
        const declaration = declarationOf(target);
        if (declaration) expected[key.slice(2)] = [declaration];
      }
      expect(mapped).toEqual(expected);
    });
  }
});
