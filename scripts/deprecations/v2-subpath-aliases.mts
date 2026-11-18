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
 * An alias can also have a module of its own, which the build exports at the
 * alias subpath: `@copilotkit/runtime/v2` adds the 1.x names of renamed
 * exports to its 2.0 entry. Such an alias ships its own files. Its
 * declarations are the ones that the build wrote, and this script tags each
 * name that a 2.0 entry also exports with that entry. Each other name is a
 * 1.x name, and it must have its own `@deprecated` tag.
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

function isPackageJson(value: unknown): value is PackageJson {
  if (typeof value !== "object" || value === null) return false;
  return "name" in value && typeof value.name === "string";
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
 * file. An alias that `exports` already has is a module of its own: the alias
 * ships that module's files instead of the files of its 2.0 entry.
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
    if (!isBuiltEntry(exports[target])) {
      throw new Error(
        `v2AliasExports: "${target}" (for "${alias}") needs an "import" and a "require" file in exports.`,
      );
    }
    const files = exports[alias] ?? exports[target];
    if (!isBuiltEntry(files)) {
      throw new Error(
        `v2AliasExports: the module of "${alias}" needs an "import" and a "require" file in exports.`,
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

/**
 * The JavaScript and declaration files of one format of an `exports` entry:
 * a file (tsdown writes the declarations next to it), or `{ types, default }`.
 */
function filesOf(target: unknown) {
  if (typeof target === "string") {
    return { file: target, types: target.replace(/\.(m|c)js$/, ".d.$1ts") };
  }
  return isAliasFiles(target)
    ? { file: target.default, types: target.types }
    : undefined;
}

/**
 * The 2.0 entries of a package for one format: each code entry that is not a
 * `/v2` alias, in the order of `exports`, with its import path, its
 * JavaScript file, and its declaration file.
 */
function entriesOf(
  pkg: PackageJson,
  exports: Record<string, unknown>,
  format: keyof AliasEntry,
) {
  const entries: { specifier: string; file: string; types: string }[] = [];
  for (const [subpath, target] of Object.entries(exports)) {
    const isEntry = typeof target === "object" && target !== null;
    if (subpath.startsWith("./v2") || !isEntry || !(format in target)) {
      continue;
    }
    const files = filesOf(Reflect.get(target, format));
    if (files === undefined) continue;
    const specifier =
      subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
    entries.push({ specifier, ...files });
  }
  return entries;
}

/**
 * The 2.0 entry whose `format` file is `file`: its import path, and its
 * declaration file. `undefined` when no 2.0 entry has the file, because the
 * alias has a module of its own.
 */
function replacementOf(
  pkg: PackageJson,
  exports: Record<string, unknown>,
  file: string,
  format: keyof AliasEntry,
) {
  return entriesOf(pkg, exports, format).find((entry) => entry.file === file);
}

/** A relative import of `file` from the directory of `fromFile`. */
function relativeImport(fromFile: string, file: string) {
  const relative = path.posix.relative(path.posix.dirname(fromFile), file);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

// Bundler resolution reads both the `.mjs` imports of tsdown and the
// extensionless imports that vue-tsc emits.
const PROGRAM_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  skipLibCheck: true,
  types: [],
};

/** The symbol of the module that the declaration file `file` declares. */
function moduleSymbolOf(program: ts.Program, file: string) {
  const source = program.getSourceFile(file);
  const moduleSymbol =
    source && program.getTypeChecker().getSymbolAtLocation(source);
  if (!moduleSymbol) {
    throw new Error(`${file} is not a module. Build the package first.`);
  }
  return moduleSymbol;
}

/** The names that each declaration file of `files` exports, sorted. */
function exportNamesOf(files: string[]) {
  const program = ts.createProgram(files, PROGRAM_OPTIONS);
  const checker = program.getTypeChecker();
  const names = new Map<string, string[]>();
  for (const file of files) {
    const exported = checker.getExportsOfModule(moduleSymbolOf(program, file));
    names.set(file, exported.map((symbol) => symbol.name).sort());
  }
  return names;
}

/** An alias with a module of its own, for one format. */
interface AliasModule {
  /** The declaration file that the build wrote, relative to the package. */
  file: string;
  alias: string;
  /** The 2.0 entries of the same format. */
  entries: { specifier: string; types: string }[];
}

/**
 * The tags of the declarations of each alias module, in the order of
 * `modules`: each name that a 2.0 entry also exports (the same symbol, not
 * only the same name), mapped to the import path of the first such entry.
 * Each other name is a 1.x name of the alias, and it must have a
 * `@deprecated` tag of its own.
 */
function moduleTagsOf(packageDir: string, modules: AliasModule[]) {
  const files = modules.flatMap(({ file, entries }) => [
    path.join(packageDir, file),
    ...entries.map(({ types }) => path.join(packageDir, types)),
  ]);
  const program = ts.createProgram([...new Set(files)], PROGRAM_OPTIONS);
  const checker = program.getTypeChecker();
  const symbolsOf = (file: string) => {
    const exported = checker.getExportsOfModule(moduleSymbolOf(program, file));
    return new Map(
      exported.map((symbol) => [
        symbol.name,
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol,
      ]),
    );
  };
  return modules.map(({ file, alias, entries }) => {
    const entrySymbols = entries.map(({ specifier, types }) => ({
      specifier,
      symbols: symbolsOf(path.join(packageDir, types)),
    }));
    const tags = new Map<string, string>();
    for (const [name, symbol] of symbolsOf(path.join(packageDir, file))) {
      const entry = entrySymbols.find(
        ({ symbols }) => symbols.get(name) === symbol,
      );
      if (entry !== undefined) {
        tags.set(name, entry.specifier);
      } else if (
        !symbol.getJsDocTags(checker).some((tag) => tag.name === "deprecated")
      ) {
        throw new Error(
          `${alias} exports ${name}, which no 2.0 entry exports. Give it a @deprecated tag that names its 2.0 name.`,
        );
      }
    }
    return { file, alias, tags };
  });
}

/** The `@deprecated` tag of a name that `alias` re-exports from `replacement`. */
function aliasNotice(alias: string, replacement: string) {
  return `@deprecated "${alias}" is deprecated. Import from "${replacement}".`;
}

/**
 * The declarations of an alias module, with a `@deprecated` tag on each name
 * of `tags` (a name mapped to its 2.0 entry). Only the `export { ... }` lists
 * change, to one name per line, so the tags of an earlier run are replaced,
 * not added twice.
 */
export function renderModuleDeclarations(
  text: string,
  alias: string,
  tags: Map<string, string>,
) {
  const source = ts.createSourceFile(
    "alias.d.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  let result = text;
  for (const statement of source.statements.toReversed()) {
    if (!ts.isExportDeclaration(statement)) continue;
    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    const specifiers = clause.elements.map((element) => {
      const replacement = tags.get(element.name.text);
      const tag =
        replacement === undefined
          ? ""
          : `  /** ${aliasNotice(alias, replacement)} */\n`;
      return `${tag}  ${element.getText(source)},\n`;
    });
    const keyword = statement.isTypeOnly ? "export type" : "export";
    const from = statement.moduleSpecifier
      ? ` from ${statement.moduleSpecifier.getText(source)}`
      : "";
    result = `${result.slice(0, statement.getStart(source))}${keyword} {\n${specifiers.join("")}}${from};${result.slice(statement.end)}`;
  }
  return result;
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
  const notice = aliasNotice(alias, replacement);
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
  const manifest = path.join(packageDir, "package.json");
  const pkg: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  if (!isPackageJson(pkg)) throw new Error(`${manifest} has no name.`);
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
  const modules: AliasModule[] = [];
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
    const formats: (keyof AliasEntry)[] = ["import", "require"];
    for (const format of formats) {
      const { types, default: file } = target[format];
      const replacement = replacementOf(pkg, exports, file, format);
      if (replacement === undefined) {
        const entries = entriesOf(pkg, exports, format);
        modules.push({ file: types, alias, entries });
        continue;
      }
      declarations.push({
        file: types,
        source: path.join(packageDir, replacement.types),
        alias,
        replacement: replacement.specifier,
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
    ...moduleTagsOf(packageDir, modules).map(({ file, alias, tags }) => ({
      file,
      text: renderModuleDeclarations(
        readFileSync(path.join(packageDir, file), "utf8"),
        alias,
        tags,
      ),
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
