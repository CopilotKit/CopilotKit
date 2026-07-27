import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractRegions } from "./lib/source-regions.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SHOWCASE_ROOT = path.resolve(SCRIPT_DIR, "..");
const CHECKOUT_ROOT = fs.existsSync(
  path.join(path.dirname(SHOWCASE_ROOT), "examples"),
)
  ? path.dirname(SHOWCASE_ROOT)
  : SHOWCASE_ROOT;

export const DEFAULT_VUE_DOC_SOURCE_ROOT = path.join(
  CHECKOUT_ROOT,
  "examples/v2/vue/docs-consumer/src",
);
export const DEFAULT_VUE_DOC_OUTPUT = path.join(
  SHOWCASE_ROOT,
  "shell-docs/src/data/vue-doc-examples.json",
);

const SUPPORTED_LANGUAGES: Record<string, string> = {
  ".ts": "typescript",
  ".vue": "vue",
};

export interface VueDocRegion {
  code: string;
  startLine: number;
  endLine: number;
}

export interface VueDocSourceFile {
  language: string;
  code: string;
  regions: Record<string, VueDocRegion>;
}

export interface VueDocExamplesBundle {
  version: 1;
  files: Record<string, VueDocSourceFile>;
}

export function assertSafeRelativePath(file: string): void {
  if (
    !file ||
    path.isAbsolute(file) ||
    file.includes("\\") ||
    file.split("/").some((segment) => segment === "" || segment === "..")
  ) {
    throw new Error(`Unsafe Vue documentation example path: "${file}"`);
  }
}

function collectSourceFiles(sourceRoot: string): string[] {
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(
      `Vue documentation example source root is missing: ${sourceRoot}`,
    );
  }

  const files: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  };

  walk(sourceRoot, "");
  if (files.length === 0) {
    throw new Error(
      `No Vue documentation example source files found in ${sourceRoot}`,
    );
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export function createVueDocExamplesBundle(
  sourceRoot: string,
): VueDocExamplesBundle {
  const files: Record<string, VueDocSourceFile> = {};

  for (const relativePath of collectSourceFiles(sourceRoot)) {
    assertSafeRelativePath(relativePath);
    const extension = path.extname(relativePath).toLowerCase();
    const language = SUPPORTED_LANGUAGES[extension];
    if (!language) {
      throw new Error(
        `Unsupported Vue documentation example source type: ${relativePath}`,
      );
    }

    const source = fs.readFileSync(path.join(sourceRoot, relativePath), "utf8");
    const extracted = extractRegions(source, relativePath);
    const regions: Record<string, VueDocRegion> = {};

    for (const regionName of Object.keys(extracted.regions).sort()) {
      const occurrences = extracted.regions[regionName];
      if (occurrences.length !== 1) {
        throw new Error(
          `${relativePath}: duplicate @region[${regionName}] identifiers are not allowed within a file.`,
        );
      }
      const [region] = occurrences;
      regions[regionName] = {
        code: region.lines.join("\n"),
        startLine: region.startLine,
        endLine: region.endLine,
      };
    }

    files[relativePath] = {
      language,
      code: extracted.cleaned,
      regions,
    };
  }

  return { version: 1, files };
}

export function writeVueDocExamplesBundle(
  sourceRoot = DEFAULT_VUE_DOC_SOURCE_ROOT,
  outputPath = DEFAULT_VUE_DOC_OUTPUT,
): VueDocExamplesBundle {
  const bundle = createVueDocExamplesBundle(sourceRoot);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`);
  return bundle;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  const bundle = writeVueDocExamplesBundle();
  console.log(
    `Bundled ${Object.keys(bundle.files).length} Vue documentation examples to ${DEFAULT_VUE_DOC_OUTPUT}`,
  );
}
