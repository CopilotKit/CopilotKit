/**
 * The `/v2` subpaths of CopilotKit 1.x (`@copilotkit/react-core/v2`,
 * `@copilotkit/runtime/v2`, ...) are the package roots in 2.0. The packages
 * keep them as deprecated aliases, so a 1.x import still resolves:
 *
 * - `v2AliasExports` adds the aliases to the `exports` map that tsdown writes
 *   into `package.json`. The JavaScript of an alias is the file of its 2.0
 *   entry, so both import paths load one module, with one copy of each React
 *   context.
 * - Run this file in the package directory after the build
 *   (`tsx ../../scripts/deprecations/v2-subpath-aliases.mts`). For each alias,
 *   it writes declarations that re-export the 2.0 entry with a `@deprecated`
 *   tag on every name, so editors strike the 1.x import through and name the
 *   2.0 one. A stylesheet alias gets an empty stylesheet: the 2.0 components
 *   add their own styles.
 *
 * Tests: scripts/__tests__/v2-subpath-aliases.test.ts.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** The files of an `exports` entry that tsdown writes for both formats. */
interface BuiltEntry {
  import: string;
  require: string;
}

/** The `exports` entry of an alias, for one format. */
interface AliasFiles {
  types: string;
  default: string;
}

/** The `exports` entry of an alias. */
interface AliasEntry {
  import: AliasFiles;
  require: AliasFiles;
}

/** The fields of `package.json` that the aliases read. */
interface PackageJson {
  name: string;
  exports?: Record<string, unknown>;
}

/** The aliases of a package, as `v2AliasExports` takes them. */
export interface V2Aliases {
  /**
   * Each alias, mapped to the 2.0 subpath that it re-exports, for example
   * `{ "./v2": ".", "./v2/node": "./node" }`.
   */
  entries: Record<string, string>;
  /** The stylesheet aliases, for example `["./v2/styles.css"]`. */
  stylesheets: string[];
}

function isBuiltEntry(value: unknown): value is BuiltEntry {
  if (typeof value !== "object" || value === null) return false;
  return (
    "import" in value &&
    typeof value.import === "string" &&
    "require" in value &&
    typeof value.require === "string"
  );
}

function isAliasEntry(value: unknown): value is AliasEntry {
  if (typeof value !== "object" || value === null) return false;
  if (!("import" in value) || !("require" in value)) return false;
  return isAliasFiles(value.import) && isAliasFiles(value.require);
}

function isAliasFiles(value: unknown): value is AliasFiles {
  if (typeof value !== "object" || value === null) return false;
  return (
    "types" in value &&
    typeof value.types === "string" &&
    "default" in value &&
    typeof value.default === "string"
  );
}

/**
 * Adds a deprecated alias for each alias of `aliases` to the `exports` map
 * that tsdown generates, and returns the new map. Each subpath in
 * `aliases.entries` must be in `exports` with an `import` and a `require`
 * file.
 *
 * @example
 * exports: {
 *   customExports: (exports) =>
 *     v2AliasExports(exports, { entries: { "./v2": "." }, stylesheets: [] }),
 * }
 */
export function v2AliasExports(
  exports: Record<string, unknown>,
  aliases: V2Aliases,
) {
  const result: Record<string, unknown> = { ...exports };
  for (const [alias, target] of Object.entries(aliases.entries)) {
    const files = exports[target];
    if (!isBuiltEntry(files)) {
      throw new Error(
        `v2AliasExports: "${target}" (for "${alias}") needs an "import" and a "require" file in exports.`,
      );
    }
    const declarations = `./dist/${alias === "./v2" ? "v2/index" : alias.slice(2)}`;
    const entry: AliasEntry = {
      import: { types: `${declarations}.d.mts`, default: files.import },
      require: { types: `${declarations}.d.cts`, default: files.require },
    };
    result[alias] = entry;
  }
  for (const alias of aliases.stylesheets) {
    result[alias] = `./dist/${alias.slice(2)}`;
  }
  return result;
}

/** The import path of the 2.0 entry whose `format` file is `file`. */
function replacementOf(
  pkg: PackageJson,
  exports: Record<string, unknown>,
  file: string,
  format: keyof BuiltEntry,
) {
  const match = Object.entries(exports).find(
    ([subpath, target]) =>
      !subpath.startsWith("./v2") &&
      isBuiltEntry(target) &&
      target[format] === file,
  );
  if (!match) {
    throw new Error(`${pkg.name} exports no 2.0 entry with the file ${file}.`);
  }
  const [subpath] = match;
  return subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
}

/** The declaration file of a built `.mjs` or `.cjs` file. */
function declarationOf(file: string) {
  return file.replace(/\.(m|c)js$/, ".d.$1ts");
}

/** A relative import of `file` from the directory of `fromFile`. */
function relativeImport(fromFile: string, file: string) {
  const relative = path.posix.relative(path.posix.dirname(fromFile), file);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

/** The names that each declaration file of `files` exports, sorted. */
function exportNamesOf(files: string[]) {
  const program = ts.createProgram(files, {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const names = new Map<string, string[]>();
  for (const file of files) {
    const source = program.getSourceFile(file);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!moduleSymbol) {
      throw new Error(`${file} is not a module. Build the package first.`);
    }
    const exported = checker.getExportsOfModule(moduleSymbol);
    names.set(file, exported.map((symbol) => symbol.name).sort());
  }
  return names;
}

/**
 * The declarations of an alias: every name of the 2.0 entry, re-exported
 * with a `@deprecated` tag. The trailing `export *` still re-exports a name
 * that `names` does not have (one that a star export of an unbuilt
 * dependency adds), without the tag.
 */
export function renderAliasDeclarations(input: {
  alias: string;
  replacement: string;
  from: string;
  names: string[];
}) {
  const { alias, replacement, from, names } = input;
  const notice = `@deprecated "${alias}" is deprecated. Import from "${replacement}".`;
  const specifiers = names.map((name) => `  /** ${notice} */\n  ${name},\n`);
  return [
    "/**",
    ` * @deprecated "${alias}" is a deprecated alias of "${replacement}".`,
    ` * Import from "${replacement}".`,
    " * @module",
    " */",
    `export {\n${specifiers.join("")}} from "${from}";`,
    `export * from "${from}";`,
    "",
  ].join("\n");
}

/** The empty stylesheet of the stylesheet alias `alias`. */
export function renderAliasStylesheet(alias: string) {
  return [
    "/*",
    ` * ${alias}`,
    " * is deprecated, and it is empty. The CopilotKit 2.0 components add",
    " * their own styles. Delete the import.",
    " */",
    "",
  ].join("\n");
}

/**
 * Writes the declarations and the stylesheets of the `/v2` aliases that the
 * `package.json` in `packageDir` exports. Run it after the build. It returns
 * the files it wrote, relative to `packageDir`.
 */
export function writeV2Aliases(packageDir: string) {
  const pkg = JSON.parse(
    readFileSync(path.join(packageDir, "package.json"), "utf8"),
  ) as PackageJson;
  const exports = pkg.exports ?? {};
  const aliases = Object.entries(exports).filter(([subpath]) =>
    subpath.startsWith("./v2"),
  );
  if (aliases.length === 0) {
    throw new Error(`${pkg.name} exports no "./v2" aliases.`);
  }

  const stylesheets: { file: string; text: string }[] = [];
  const declarations: {
    file: string;
    source: string;
    alias: string;
    replacement: string;
    from: string;
  }[] = [];
  for (const [subpath, target] of aliases) {
    const alias = `${pkg.name}/${subpath.slice(2)}`;
    if (typeof target === "string") {
      stylesheets.push({ file: target, text: renderAliasStylesheet(alias) });
      continue;
    }
    if (!isAliasEntry(target)) {
      throw new Error(
        `${alias} is not a /v2 alias: run the build first, so that v2AliasExports writes it.`,
      );
    }
    const formats: (keyof BuiltEntry)[] = ["import", "require"];
    for (const format of formats) {
      const { types, default: file } = target[format];
      declarations.push({
        file: types,
        source: path.join(packageDir, declarationOf(file)),
        alias,
        replacement: replacementOf(pkg, exports, file, format),
        from: relativeImport(types, file),
      });
    }
  }

  const names = exportNamesOf(declarations.map(({ source }) => source));
  const outputs = [
    ...stylesheets,
    ...declarations.map(({ file, source, ...declaration }) => ({
      file,
      text: renderAliasDeclarations({
        ...declaration,
        names: names.get(source) ?? [],
      }),
    })),
  ];
  for (const { file, text } of outputs) {
    const output = path.join(packageDir, file);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, text);
  }
  return outputs.map(({ file }) => file);
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const written = writeV2Aliases(process.cwd());
  console.log(`Wrote ${written.length} deprecated /v2 alias file(s).`);
}
