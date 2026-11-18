/**
 * Stubs for the CopilotKit 1.x exports that 2.0 removed.
 *
 * A 1.x app that upgrades to 2.0 imports names that 2.0 no longer has. Each
 * such name gets a stand-in (`removedApi` and `RemovedType` from
 * `@copilotkit/shared`) that fails with a message about the replacement. The
 * replacements are in one table, packages/shared/src/removed-exports-table.ts.
 * This script keeps the table, the stand-ins, and the builds in step:
 *
 *   pnpm exec tsx scripts/deprecations/removed-exports.mts pack
 *     Runs `npm pack` for the 1.x releases in SCOPES, in an empty temporary
 *     directory, and reads only their declaration files. It writes the
 *     exports of each entrypoint to removed-exports.v1.json. It needs the
 *     network. Run it again when SCOPES changes.
 *
 *   pnpm exec tsx scripts/deprecations/removed-exports.mts generate
 *     Writes the stand-in module of each package from the table and
 *     removed-exports.v1.json.
 *
 *   pnpm exec tsx scripts/deprecations/removed-exports.mts check
 *     Fails when a stand-in module is out of date. After a build of the
 *     packages, it also fails when the table does not match the exports that
 *     2.0 removed. Tests: scripts/__tests__/removed-exports*.test.ts.
 *
 *   pnpm exec tsx scripts/deprecations/removed-exports.mts report
 *     Prints the stand-ins and the names without a stand-in, per entrypoint.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  NOT_STUBBED,
  REMOVED_EXPORTS,
  RESTORED_BY_V2_ALIAS,
} from "../../packages/shared/src/removed-exports-table.ts";
import type { RemovedExport } from "../../packages/shared/src/removed-exports-table.ts";
import {
  CopilotKitErrorCode,
  ERROR_CONFIG,
  removedApiMessage,
} from "../../packages/shared/src/utils/errors.ts";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** The committed exports of the 1.x entrypoints, written by `pack`. */
export const V1_EXPORTS_FILE = path.join(
  repoRoot,
  "scripts/deprecations/removed-exports.v1.json",
);

/** A 1.x package, and the entrypoints that this script compares with 2.0. */
interface Scope {
  /** The npm package. */
  name: string;
  /** The 1.x release to compare with 2.0. */
  release: string;
  /**
   * The newest 1.x release that the 2.0.0 branch contains: its tag is an
   * ancestor of origin/2.0.0. A name that `release` exports and `syncBase`
   * does not was added to main after the last main → 2.0.0 sync. 2.0 did not
   * remove it; the next sync adds it. So it gets no stand-in.
   */
  syncBase: string;
  /** The package directory in this repository. */
  directory: string;
  /**
   * Each 1.x subpath in scope, mapped to the 2.0 subpath that serves it. A
   * `/v2` subpath of 1.x is a deprecated alias of a 2.0 entry: the same
   * JavaScript file.
   */
  entrypoints: Record<string, string>;
}

export const SCOPES: Scope[] = [
  {
    name: "@copilotkit/react-core",
    release: "1.89.0",
    syncBase: "1.87.0",
    directory: "packages/react-core",
    entrypoints: {
      ".": ".",
      "./v2": ".",
      "./v2/generative-ui": "./generative-ui",
      "./v2/generative-ui/native": "./generative-ui/native",
      "./v2/context": "./context",
      "./v2/headless": "./headless",
    },
  },
  {
    name: "@copilotkit/runtime",
    release: "1.89.0",
    syncBase: "1.87.0",
    directory: "packages/runtime",
    entrypoints: { ".": ".", "./v2": ".", "./v2/node": "./node" },
  },
  {
    name: "@copilotkit/shared",
    release: "1.89.0",
    syncBase: "1.87.0",
    directory: "packages/shared",
    entrypoints: { ".": ".", "./generative-ui": "./generative-ui" },
  },
  {
    name: "@copilotkit/vue",
    release: "1.89.0",
    syncBase: "1.87.0",
    directory: "packages/vue",
    entrypoints: {
      ".": ".",
      "./v2": ".",
      "./v2/generative-ui": "./generative-ui",
      "./v2/generative-ui/chart": "./generative-ui/chart",
      "./v2/generative-ui/map": "./generative-ui/map",
    },
  },
  {
    // The Angular package of the 1.x line is versioned 0.x. 0.6.0 is its
    // last release, and the 2.0.0 branch contains it.
    name: "@copilotkit/angular",
    release: "0.6.0",
    syncBase: "0.6.0",
    directory: "packages/angular",
    entrypoints: { ".": "." },
  },
];

/**
 * The stand-in module of each 2.0 entry that has stand-ins, relative to the
 * repository, and the import path of `removedApi` and `RemovedType` in it.
 */
export const STUB_MODULES: Record<string, { file: string; helpers: string }> = {
  "@copilotkit/react-core": {
    file: "packages/react-core/src/removed-exports.ts",
    helpers: "@copilotkit/shared",
  },
  // .oxlintrc.json turns off two rules for this module: they need
  // strictNullChecks, which the runtime does not compile with.
  "@copilotkit/runtime": {
    file: "packages/runtime/src/removed-exports.ts",
    helpers: "@copilotkit/shared",
  },
  "@copilotkit/shared": {
    file: "packages/shared/src/removed-exports.ts",
    helpers: "./utils/removed-api",
  },
  "@copilotkit/vue": {
    file: "packages/vue/src/removed-exports.ts",
    helpers: "@copilotkit/shared",
  },
  "@copilotkit/angular": {
    file: "packages/angular/src/removed-exports.ts",
    helpers: "@copilotkit/shared",
  },
};

/** What a 1.x export is, as its declaration file says. */
export interface V1Export {
  /**
   * `function` and `class` get a stand-in that throws. A `constant` cannot
   * throw when code reads it, so it gets none. A `type` gets a stand-in type.
   */
  kind: "function" | "class" | "constant" | "type";
  /** A value that also has a type of the same name, such as a class. */
  alsoType?: true;
  /** The number of type parameters of the type. */
  typeParameters?: number;
  /** The package that declares it, when it is not a CopilotKit package. */
  from?: string;
}

/** The exports of one 1.x entrypoint. */
export interface V1Entrypoint {
  exports: Record<string, V1Export>;
  /** The names that `release` exports and `syncBase` does not. */
  notInSyncBase: string[];
}

/** The 1.x exports of each package in SCOPES. */
export interface V1Exports {
  packages: Record<
    string,
    {
      release: string;
      syncBase: string;
      entrypoints: Record<string, V1Entrypoint>;
    }
  >;
}

/**
 * One entrypoint in removed-exports.v1.json: the names grouped by kind, each
 * name once, so that the file stays small and a review shows each change.
 */
interface V1EntrypointFile {
  functions: string[];
  classes: string[];
  constants: string[];
  types: string[];
  /** Values that also have a type of the same name. */
  alsoTypes: string[];
  typeParameters: Record<string, number>;
  /** The names that a package other than CopilotKit declares, by package. */
  external: Record<string, string[]>;
  notInSyncBase: string[];
}

/** The content of removed-exports.v1.json. */
interface V1ExportsFile {
  packages: Record<
    string,
    {
      release: string;
      syncBase: string;
      entrypoints: Record<string, V1EntrypointFile>;
    }
  >;
}

const KIND_KEYS = {
  function: "functions",
  class: "classes",
  constant: "constants",
  type: "types",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a JSON file. The caller checks the shape. */
function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** An entrypoint as removed-exports.v1.json stores it. */
function toEntrypointFile({ exports, notInSyncBase }: V1Entrypoint) {
  const file: V1EntrypointFile = {
    functions: [],
    classes: [],
    constants: [],
    types: [],
    alsoTypes: [],
    typeParameters: {},
    external: {},
    notInSyncBase,
  };
  const names = Object.keys(exports).sort();
  for (const name of names) {
    const info = exports[name];
    if (!info) continue;
    file[KIND_KEYS[info.kind]].push(name);
    if (info.alsoType) file.alsoTypes.push(name);
    if (info.typeParameters) file.typeParameters[name] = info.typeParameters;
    if (info.from) {
      const external = file.external[info.from] ?? [];
      external.push(name);
      file.external[info.from] = external;
    }
  }
  return file;
}

/** An entrypoint from removed-exports.v1.json. */
function fromEntrypointFile(file: V1EntrypointFile) {
  const from = new Map<string, string>();
  for (const [external, names] of Object.entries(file.external)) {
    for (const name of names) from.set(name, external);
  }
  const exports: Record<string, V1Export> = {};
  for (const [kind, key] of Object.entries(KIND_KEYS)) {
    for (const name of file[key]) {
      const typeParameters = file.typeParameters[name];
      const external = from.get(name);
      exports[name] = {
        kind: isKind(kind) ? kind : "constant",
        ...(file.alsoTypes.includes(name) ? { alsoType: true as const } : {}),
        ...(typeParameters ? { typeParameters } : {}),
        ...(external ? { from: external } : {}),
      };
    }
  }
  const entrypoint: V1Entrypoint = {
    exports,
    notInSyncBase: file.notInSyncBase,
  };
  return entrypoint;
}

function isKind(value: string): value is V1Export["kind"] {
  return value in KIND_KEYS;
}

/**
 * Whether `value` has the shape of removed-exports.v1.json. `pack` writes the
 * file from the V1ExportsFile type, so this checks the top levels only.
 */
function isV1ExportsFile(value: unknown): value is V1ExportsFile {
  if (!isRecord(value) || !isRecord(value.packages)) return false;
  return Object.values(value.packages).every(
    (entry) => isRecord(entry) && isRecord(entry.entrypoints),
  );
}

/** Reads removed-exports.v1.json. */
export function readV1Exports() {
  const parsed = readJson(V1_EXPORTS_FILE);
  if (!isV1ExportsFile(parsed)) {
    throw new Error(`${V1_EXPORTS_FILE} is not a list of 1.x exports.`);
  }
  const packages: V1Exports["packages"] = {};
  for (const [name, entry] of Object.entries(parsed.packages)) {
    const entrypoints: Record<string, V1Entrypoint> = {};
    for (const [subpath, file] of Object.entries(entry.entrypoints)) {
      entrypoints[subpath] = fromEntrypointFile(file);
    }
    packages[name] = { ...entry, entrypoints };
  }
  const v1: V1Exports = { packages };
  return v1;
}

/* -------------------------------------------------------------------------- */
/* Declaration files                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The declaration file of an `exports` entry of a package.json: its `types`,
 * or the `.d.mts` next to its ESM file.
 */
export function declarationFileOf(
  packageDir: string,
  packageJson: unknown,
  subpath: string,
) {
  const exportsMap = isRecord(packageJson) ? packageJson.exports : undefined;
  const entry = isRecord(exportsMap) ? exportsMap[subpath] : undefined;
  const conditions = isRecord(entry) ? entry : {};
  const esm = conditions.import;
  const candidates = [
    conditions.types,
    isRecord(esm) ? esm.types : undefined,
    typeof esm === "string" ? esm.replace(/\.mjs$/, ".d.mts") : undefined,
  ];
  const file = candidates.find(
    (candidate): candidate is string => typeof candidate === "string",
  );
  if (file === undefined) {
    throw new Error(`No declaration file for "${subpath}" in ${packageDir}.`);
  }
  return path.join(packageDir, file);
}

/** The package that declares `declaration`, when it is in node_modules. */
function packageOfDeclaration(declaration: ts.Declaration) {
  const file = declaration.getSourceFile().fileName.split(path.sep).join("/");
  const match =
    /\/node_modules\/((?:@[^/]+\/)?[^/]+)\/(?!.*\/node_modules\/)/.exec(file);
  return match?.[1];
}

/** The type parameter count of the type declarations of `symbol`. */
function typeParameterCount(symbol: ts.Symbol) {
  let count = 0;
  for (const declaration of symbol.declarations ?? []) {
    const isGeneric =
      ts.isInterfaceDeclaration(declaration) ||
      ts.isTypeAliasDeclaration(declaration) ||
      ts.isClassDeclaration(declaration);
    if (isGeneric) {
      count = Math.max(count, declaration.typeParameters?.length ?? 0);
    }
  }
  return count;
}

/** Whether an export specifier or its alias chain is type-only. */
function isTypeOnlyExport(checker: ts.TypeChecker, symbol: ts.Symbol) {
  const declarations = symbol.declarations ?? [];
  const typeOnly = declarations.some(
    (declaration) =>
      ts.isTypeOnlyImportOrExportDeclaration(declaration) ||
      (ts.isExportSpecifier(declaration) && declaration.isTypeOnly),
  );
  if (typeOnly) return true;
  const next =
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getImmediateAliasedSymbol(symbol)
      : undefined;
  return next !== undefined && next !== symbol
    ? isTypeOnlyExport(checker, next)
    : false;
}

/** What the export `symbol` is. */
function describeExport(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  ownPackage: string,
) {
  const target =
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  const declaration = target.declarations?.[0];
  const declaredIn = declaration
    ? packageOfDeclaration(declaration)
    : undefined;
  const isExternal =
    declaredIn !== undefined &&
    declaredIn !== ownPackage &&
    !declaredIn.startsWith("@copilotkit/");
  const from = isExternal ? declaredIn : undefined;
  const typeParameters = typeParameterCount(target);
  const generic = typeParameters > 0 ? { typeParameters } : {};
  const external = from ? { from } : {};

  const isTypeOnly =
    isTypeOnlyExport(checker, symbol) ||
    (target.flags & ts.SymbolFlags.Type &&
      !(target.flags & ts.SymbolFlags.Value));
  if (isTypeOnly) {
    const info: V1Export = { kind: "type", ...generic, ...external };
    return info;
  }

  const alsoType =
    target.flags & ts.SymbolFlags.Type ? { alsoType: true as const } : {};
  if (target.flags & ts.SymbolFlags.Class) {
    const info: V1Export = { kind: "class", ...generic, ...external };
    return info;
  }
  if (target.flags & ts.SymbolFlags.Function) {
    const info: V1Export = { kind: "function", ...alsoType, ...generic };
    return { ...info, ...external };
  }
  if (target.flags & ts.SymbolFlags.Variable && declaration) {
    const type = checker.getTypeOfSymbolAtLocation(target, declaration);
    const kind = type.getConstructSignatures().length
      ? "class"
      : type.getCallSignatures().length
        ? "function"
        : "constant";
    const info: V1Export = { kind, ...alsoType, ...generic, ...external };
    return info;
  }
  // An enum, a namespace, or a name from a package that did not resolve.
  const info: V1Export = { kind: "constant", ...alsoType, ...external };
  return info;
}

/**
 * The exports of each declaration file in `files`, by name. `owners` maps
 * each file to the package that it belongs to.
 */
export function listExports(files: string[], owners: Map<string, string>) {
  const program = ts.createProgram(files, {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const result = new Map<string, Map<string, V1Export>>();
  for (const file of files) {
    const source = program.getSourceFile(file);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!moduleSymbol) throw new Error(`${file} is not a module.`);
    const ownPackage = owners.get(file) ?? "";
    const exports = new Map<string, V1Export>();
    const symbols = checker.getExportsOfModule(moduleSymbol);
    for (const symbol of symbols) {
      exports.set(symbol.name, describeExport(checker, symbol, ownPackage));
    }
    result.set(file, exports);
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* pack                                                                       */
/* -------------------------------------------------------------------------- */

/** The version of `name` that `range` selects on npm. */
function resolveVersion(name: string, range: string) {
  if (/^\d+\.\d+\.\d+$/.test(range)) return range;
  const output = execFileSync(
    "npm",
    ["view", `${name}@${range}`, "version", "--json"],
    { encoding: "utf8" },
  );
  const parsed: unknown = JSON.parse(output);
  const versions = Array.isArray(parsed) ? parsed : [parsed];
  const last = versions.at(-1);
  if (typeof last !== "string") {
    throw new Error(`npm has no ${name}@${range}.`);
  }
  return last;
}

/**
 * The dependencies whose declarations decide what a 1.x export is: the
 * CopilotKit and AG-UI packages that an entrypoint re-exports, and Vue,
 * whose `DefineComponent` type makes a component constructible.
 */
const DECLARATION_DEPENDENCIES = /^(?:@copilotkit\/|@ag-ui\/|@vue\/|vue$)/;

/**
 * Runs `npm pack` for `name@version` and extracts it into
 * `<tree>/node_modules/<name>`, with the DECLARATION_DEPENDENCIES that it
 * depends on, so that its declaration files resolve. Nothing in the packages
 * runs.
 */
function packInto(tree: string, name: string, version: string) {
  const target = path.join(tree, "node_modules", name);
  if (existsSync(target)) return target;
  const tarballs = mkdtempSync(path.join(tree, ".tarballs-"));
  const tarball = execFileSync(
    "npm",
    ["pack", `${name}@${version}`, "--pack-destination", tarballs, "--silent"],
    { encoding: "utf8", cwd: tarballs },
  ).trim();
  mkdirSync(target, { recursive: true });
  execFileSync("tar", [
    "xzf",
    path.join(tarballs, tarball),
    "-C",
    target,
    "--strip-components=1",
  ]);
  rmSync(tarballs, { recursive: true, force: true });

  const manifest = readJson(path.join(target, "package.json"));
  const fields = isRecord(manifest)
    ? [manifest.dependencies, manifest.peerDependencies]
    : [];
  const entries = fields.flatMap((field) =>
    isRecord(field) ? Object.entries(field) : [],
  );
  for (const [dependency, range] of entries) {
    const isNeeded = DECLARATION_DEPENDENCIES.test(dependency);
    if (!isNeeded || typeof range !== "string") continue;
    packInto(tree, dependency, resolveVersion(dependency, range));
  }
  return target;
}

/** The exports of each entrypoint of `scope` in `version`. */
function exportsOfRelease(root: string, scope: Scope, version: string) {
  const tree = path.join(root, `${scope.name.replace("/", "+")}@${version}`);
  mkdirSync(tree, { recursive: true });
  const packageDir = packInto(tree, scope.name, version);
  const manifest = readJson(path.join(packageDir, "package.json"));
  const subpaths = Object.keys(scope.entrypoints);
  const files = subpaths.map((subpath) =>
    declarationFileOf(packageDir, manifest, subpath),
  );
  const owners = new Map(files.map((file) => [file, scope.name]));
  const exports = listExports(files, owners);
  return new Map(
    subpaths.map((subpath, index) => [
      subpath,
      exports.get(files[index] ?? "") ?? new Map<string, V1Export>(),
    ]),
  );
}

/** removed-exports.v1.json as text, formatted with oxfmt. */
function renderV1Exports(output: V1Exports) {
  const packages: V1ExportsFile["packages"] = {};
  for (const [name, entry] of Object.entries(output.packages)) {
    const entrypoints: Record<string, V1EntrypointFile> = {};
    for (const [subpath, entrypoint] of Object.entries(entry.entrypoints)) {
      entrypoints[subpath] = toEntrypointFile(entrypoint);
    }
    packages[name] = { ...entry, entrypoints };
  }
  const file: V1ExportsFile = { packages };
  return format(V1_EXPORTS_FILE, `${JSON.stringify(file, null, 2)}\n`);
}

/** `pack`: writes removed-exports.v1.json. */
function pack() {
  const root = mkdtempSync(path.join(tmpdir(), "copilotkit-v1-exports-"));
  try {
    const packages: V1Exports["packages"] = {};
    for (const scope of SCOPES) {
      const release = exportsOfRelease(root, scope, scope.release);
      const syncBase =
        scope.syncBase === scope.release
          ? release
          : exportsOfRelease(root, scope, scope.syncBase);
      const entrypoints: Record<string, V1Entrypoint> = {};
      for (const [subpath, exports] of release) {
        const base = syncBase.get(subpath) ?? new Map<string, V1Export>();
        const names = [...exports.keys()].sort();
        entrypoints[subpath] = {
          exports: Object.fromEntries(
            names.map((name) => [name, exports.get(name)]),
          ),
          notInSyncBase: names.filter((name) => !base.has(name)),
        };
      }
      packages[scope.name] = {
        release: scope.release,
        syncBase: scope.syncBase,
        entrypoints,
      };
    }
    const output: V1Exports = { packages };
    writeFileSync(V1_EXPORTS_FILE, renderV1Exports(output));
    console.log(`Wrote ${path.relative(repoRoot, V1_EXPORTS_FILE)}.`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* Which names get a stand-in                                                 */
/* -------------------------------------------------------------------------- */

/** The 2.0 module that serves a 1.x entrypoint, as an import path. */
function moduleOf(scope: Scope, subpath: string) {
  const target = scope.entrypoints[subpath] ?? ".";
  return target === "." ? scope.name : `${scope.name}/${target.slice(2)}`;
}

/** The import path of a 1.x entrypoint. */
export function importPathOf(scope: Scope, subpath: string) {
  return subpath === "." ? scope.name : `${scope.name}/${subpath.slice(2)}`;
}

/**
 * Why a name that 1.x exports, and that 2.0 does not, gets no stand-in, when
 * the reason follows from the 1.x declaration. `undefined`: it needs a
 * stand-in or an entry in NOT_STUBBED.
 */
export function automaticReason(
  name: string,
  info: V1Export,
  entrypoint: V1Entrypoint,
) {
  if (entrypoint.notInSyncBase.includes(name)) {
    return "added to main after the last main → 2.0.0 sync: the next sync adds it, so 2.0 did not remove it";
  }
  if (info.from?.startsWith("@ag-ui/")) {
    return `a re-export of ${info.from}: 2.0 still re-exports that package, so its version decides the name, not CopilotKit`;
  }
  if (name.startsWith("ɵ")) {
    return "private (ɵ): not part of the public API";
  }
  return undefined;
}

/** The stand-ins of one 2.0 module, with what each 1.x export was. */
export function stubsOf(moduleName: string, v1: V1Exports) {
  const entries: Record<string, RemovedExport> =
    REMOVED_EXPORTS[moduleName] ?? {};
  const stubs: Array<{ name: string; entry: RemovedExport; info: V1Export }> =
    [];
  for (const [name, entry] of Object.entries(entries)) {
    const kinds: V1Export[] = [];
    for (const scope of SCOPES) {
      const subpaths = Object.keys(scope.entrypoints);
      for (const subpath of subpaths) {
        if (moduleOf(scope, subpath) !== moduleName) continue;
        const info =
          v1.packages[scope.name]?.entrypoints[subpath]?.exports[name];
        if (info) kinds.push(info);
      }
    }
    if (kinds.length === 0) {
      throw new Error(`${moduleName}: no 1.x entrypoint exported "${name}".`);
    }
    stubs.push({ name, entry, info: mergeKinds(moduleName, name, kinds) });
  }
  return stubs.sort((a, b) => a.name.localeCompare(b.name));
}

/** One description for a name that several 1.x entrypoints exported. */
function mergeKinds(moduleName: string, name: string, kinds: V1Export[]) {
  const values = kinds.filter((info) => info.kind !== "type");
  const constants = values.filter((info) => info.kind === "constant");
  if (constants.length > 0) {
    throw new Error(
      `${moduleName}: "${name}" is a constant in 1.x. A stand-in cannot throw when code reads a constant: list it in NOT_STUBBED instead.`,
    );
  }
  const typeParameters = Math.max(
    0,
    ...kinds.map((info) => info.typeParameters ?? 0),
  );
  const hasType = kinds.some(
    (info) => info.kind !== "function" || info.alsoType === true,
  );
  const first = values[0];
  const merged: V1Export = first
    ? { kind: first.kind, ...(hasType ? { alsoType: true as const } : {}) }
    : { kind: "type" };
  return typeParameters > 0 ? { ...merged, typeParameters } : merged;
}

/* -------------------------------------------------------------------------- */
/* generate                                                                   */
/* -------------------------------------------------------------------------- */

/** `_T1 = unknown, _T2 = unknown`: type parameters that accept anything. */
function anyTypeParameters(count: number) {
  if (count === 0) return "";
  const names = Array.from(
    { length: count },
    (_, index) => `_T${index + 1} = unknown`,
  );
  return `<${names.join(", ")}>`;
}

/** The source of the stand-in module of `moduleName`, before formatting. */
export function renderStubModule(moduleName: string, v1: V1Exports) {
  const stubModule = STUB_MODULES[moduleName];
  if (!stubModule) throw new Error(`${moduleName} has no stand-in module.`);
  const stubs = stubsOf(moduleName, v1);
  const helpers = JSON.stringify(stubModule.helpers);
  const hasValues = stubs.some(({ info }) => info.kind !== "type");
  const hasTypes = stubs.some(({ info }) => info.kind === "type");

  const lines = [
    "// GENERATED FILE — DO NOT EDIT BY HAND.",
    "// Regenerate with: pnpm exec tsx scripts/deprecations/removed-exports.mts generate",
    "//",
    `// Stand-ins for the CopilotKit 1.x exports that 2.0 removed from ${moduleName}.`,
    "// Calling, constructing, or rendering one throws a CopilotKitRemovedApiError,",
    "// and importing one does not. TypeScript fails on the same code with the same",
    "// message. The replacements are in packages/shared/src/removed-exports-table.ts.",
    "",
    ...(hasValues ? [`import { removedApi } from ${helpers};`] : []),
    ...(hasTypes ? [`import type { RemovedType } from ${helpers};`] : []),
    "",
  ];
  for (const { name, entry, info } of stubs) {
    const message = removedApiMessage({ what: `"${name}"`, ...entry });
    const docComment = `/** @deprecated ${message} */`;
    const typeParameters = anyTypeParameters(info.typeParameters ?? 0);
    if (info.kind === "type") {
      lines.push(
        docComment,
        `export type ${name}${typeParameters} = RemovedType<${JSON.stringify(name)}, ${JSON.stringify(entry.use)}, ${JSON.stringify(entry.docs)}>;`,
        "",
      );
      continue;
    }
    lines.push(
      docComment,
      `export const ${name} = /*#__PURE__*/ removedApi({ name: ${JSON.stringify(name)}, use: ${JSON.stringify(entry.use)}, docs: ${JSON.stringify(entry.docs)} });`,
    );
    if (info.alsoType) {
      lines.push(
        docComment,
        `export type ${name}${typeParameters} = typeof ${name};`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Formats `source` as the file `file` with oxfmt. */
function format(file: string, source: string) {
  return execFileSync(
    path.join(repoRoot, "node_modules/.bin/oxfmt"),
    [`--stdin-filepath=${file}`],
    { cwd: repoRoot, input: source, encoding: "utf8" },
  );
}

/** Every stand-in module, as its path and its formatted source. */
export function generateStubModules() {
  const v1 = readV1Exports();
  return Object.entries(STUB_MODULES).map(([moduleName, { file }]) => {
    const absolute = path.join(repoRoot, file);
    return {
      file: absolute,
      source: format(absolute, renderStubModule(moduleName, v1)),
    };
  });
}

/** The stand-in modules whose file differs from what `generate` writes. */
export function staleStubModules() {
  return generateStubModules()
    .filter(
      ({ file, source }) =>
        !existsSync(file) || readFileSync(file, "utf8") !== source,
    )
    .map(({ file }) => path.relative(repoRoot, file));
}

function generate() {
  for (const { file, source } of generateStubModules()) {
    writeFileSync(file, source);
    console.log(`Wrote ${path.relative(repoRoot, file)}.`);
  }
}

/* -------------------------------------------------------------------------- */
/* docs sections                                                              */
/* -------------------------------------------------------------------------- */

/** The pages of docs.copilotkit.ai. */
export const DOCS_ROOT = path.join(
  repoRoot,
  "showcase/shell-docs/src/content/docs",
);

/** Every Markdown page under `directory`. */
function markdownFilesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFilesIn(file);
    return /\.mdx?$/.test(entry.name) ? [file] : [];
  });
}

/**
 * The URL path of a docs page: `migrate/v2.mdx` is `/migrate/v2`. A route
 * group, such as `(shared)`, is not part of the URL.
 */
function urlPathOf(file: string) {
  const segments = path
    .relative(DOCS_ROOT, file)
    .replace(/\.mdx?$/, "")
    .split(path.sep)
    .filter((segment) => !/^\(.*\)$/.test(segment));
  if (segments.at(-1) === "index") segments.pop();
  return `/${segments.join("/")}`;
}

/**
 * The id that the docs give a heading, by the rule of github-slugger, which
 * Fumadocs uses: lowercase, without each character that is not a letter, a
 * mark, a number, `_`, `-`, or a space, and with a hyphen for each space.
 */
export function headingSlug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

/** The text that a Markdown heading shows: no links, code marks, or emphasis. */
function headingText(markdown: string) {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .trim();
}

/** The heading ids of one page, as the docs number repeated headings. */
export function headingIdsOf(source: string) {
  const ids = new Set<string>();
  const occurrences = new Map<string, number>();
  let fence: string | undefined;
  const lines = source.split("\n");
  for (const line of lines) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      const closes =
        fence !== undefined &&
        marker[0] === fence[0] &&
        marker.length >= fence.length;
      fence = fence === undefined ? marker : closes ? undefined : fence;
      continue;
    }
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    if (fence !== undefined || heading === undefined) continue;
    const customId = /\[#([^\]]+)\]$/.exec(heading)?.[1];
    if (customId !== undefined) {
      ids.add(customId);
      continue;
    }
    const slug = headingSlug(headingText(heading));
    let id = slug;
    while (occurrences.has(id)) {
      const count = (occurrences.get(slug) ?? 0) + 1;
      occurrences.set(slug, count);
      id = `${slug}-${count}`;
    }
    occurrences.set(id, 0);
    ids.add(id);
  }
  return ids;
}

/** The heading ids of each docs page, by URL path. */
export function docsHeadingIds() {
  const pages = new Map<string, Set<string>>();
  for (const file of markdownFilesIn(DOCS_ROOT)) {
    pages.set(urlPathOf(file), headingIdsOf(readFileSync(file, "utf8")));
  }
  return pages;
}

/** Every source file of a package, without tests. */
function packageSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    const isTest =
      entry.name === "__tests__" ||
      /\.(test|spec)\.[cm]?tsx?$/.test(entry.name);
    if (isTest || entry.name === "node_modules") return [];
    if (entry.isDirectory()) return packageSourceFiles(file);
    return /\.(tsx?|vue)$/.test(entry.name) ? [file] : [];
  });
}

/**
 * The packages that throw a CopilotKitRemovedApiError: those of SCOPES, and
 * core, which checks the props of the providers.
 */
const ERROR_PACKAGES = [
  ...SCOPES.map((scope) => scope.directory),
  "packages/core",
];

/**
 * The docs sections that the source of ERROR_PACKAGES links to: each docs URL
 * with a heading, and each string such as `"/migrate/v2#hook-mapping"` (the
 * `docs` of a CopilotKitRemovedApiError).
 */
function docsSectionsInSources() {
  const sections = new Set<string>();
  for (const directory of ERROR_PACKAGES) {
    const source = path.join(repoRoot, directory, "src");
    for (const file of packageSourceFiles(source)) {
      const text = readFileSync(file, "utf8");
      const urls = text.matchAll(
        /https:\/\/docs\.copilotkit\.ai(\/[\w./-]*#[\w.-]+)/g,
      );
      for (const [, section] of urls) if (section) sections.add(section);
      const paths = text.matchAll(/"(\/[\w./-]+#[\w.-]+)"/g);
      for (const [, section] of paths) if (section) sections.add(section);
    }
  }
  return sections;
}

/**
 * The docs sections that the table, the error code, and the source of the
 * packages link to, and that no heading of the docs has.
 */
export function missingDocsSections() {
  const pages = docsHeadingIds();
  const sections = docsSectionsInSources();
  for (const entries of Object.values(REMOVED_EXPORTS)) {
    for (const { docs } of Object.values(entries)) sections.add(docs);
  }
  const errorLink =
    ERROR_CONFIG[CopilotKitErrorCode.REMOVED_API].troubleshootingUrl;
  sections.add(errorLink.replace(/^https:\/\/docs\.copilotkit\.ai/, ""));
  return [...sections].sort().filter((section) => {
    const [page = "", id = ""] = section.split("#");
    return !pages.get(page)?.has(id);
  });
}

/* -------------------------------------------------------------------------- */
/* check against the builds                                                   */
/* -------------------------------------------------------------------------- */

/** A 1.x entrypoint, compared with the build of its 2.0 entry. */
export interface EntrypointDiff {
  importPath: string;
  module: string;
  /** The names that 1.x exports and the 2.0 build does not, or only as a stand-in. */
  removed: string[];
  /** The removed names with a stand-in. */
  stubbed: string[];
  /** The removed names without a stand-in, with the reason. */
  notStubbed: Record<string, string>;
}

/**
 * Compares each 1.x entrypoint with the build of its 2.0 entry, and returns
 * the comparison and the problems. Build the packages first.
 */
export function compareWithBuilds() {
  const v1 = readV1Exports();
  const problems: string[] = [];
  const diffs: EntrypointDiff[] = [];
  const files: string[] = [];
  const owners = new Map<string, string>();
  const fileOf = new Map<string, string>();
  for (const scope of SCOPES) {
    const packageDir = path.join(repoRoot, scope.directory);
    const manifest = readJson(path.join(packageDir, "package.json"));
    for (const subpath of Object.keys(scope.entrypoints)) {
      const file = declarationFileOf(packageDir, manifest, subpath);
      if (!existsSync(file)) {
        throw new Error(`${file} does not exist. Build ${scope.name} first.`);
      }
      files.push(file);
      owners.set(file, scope.name);
      fileOf.set(importPathOf(scope, subpath), file);
    }
  }
  const built = listExports(files, owners);
  const stubbedAnywhere = new Map<string, Set<string>>();

  for (const scope of SCOPES) {
    const packageV1 = v1.packages[scope.name];
    if (!packageV1) {
      problems.push(`removed-exports.v1.json has no ${scope.name}: run pack.`);
      continue;
    }
    for (const subpath of Object.keys(scope.entrypoints)) {
      const importPath = importPathOf(scope, subpath);
      const moduleName = moduleOf(scope, subpath);
      const entrypoint = packageV1.entrypoints[subpath];
      const exports2 = built.get(fileOf.get(importPath) ?? "");
      if (!entrypoint || !exports2) {
        problems.push(`${importPath}: no 1.x or 2.0 exports.`);
        continue;
      }
      const stubNames = new Set(Object.keys(REMOVED_EXPORTS[moduleName] ?? {}));
      const exclusions = NOT_STUBBED[importPath] ?? {};
      const diff: EntrypointDiff = {
        importPath,
        module: moduleName,
        removed: [],
        stubbed: [],
        notStubbed: {},
      };
      for (const [name, info] of Object.entries(entrypoint.exports)) {
        const isKept = exports2.has(name) && !stubNames.has(name);
        if (isKept) continue;
        diff.removed.push(name);
        const reason =
          exclusions[name] ?? automaticReason(name, info, entrypoint);
        if (reason !== undefined) {
          diff.notStubbed[name] = reason;
          continue;
        }
        if (!stubNames.has(name)) {
          problems.push(
            `${importPath}: 2.0 removed "${name}". Add it to REMOVED_EXPORTS["${moduleName}"] in the table, or to NOT_STUBBED["${importPath}"] with the reason.`,
          );
          continue;
        }
        if (!exports2.has(name)) {
          problems.push(
            `${importPath}: the build does not export the stand-in "${name}". Check for another export of the same name.`,
          );
          continue;
        }
        diff.stubbed.push(name);
        const users = stubbedAnywhere.get(moduleName) ?? new Set<string>();
        users.add(name);
        stubbedAnywhere.set(moduleName, users);
      }
      for (const [name, reason] of Object.entries(exclusions)) {
        const isStale = !diff.removed.includes(name);
        // A parallel change restores these names on the /v2 alias. When it
        // lands, the entries are stale, and that must not fail its checks.
        if (isStale && reason !== RESTORED_BY_V2_ALIAS) {
          problems.push(
            `${importPath}: NOT_STUBBED lists "${name}", but 2.0 exports it. Delete the entry.`,
          );
        }
      }
      diffs.push(diff);
    }
  }
  for (const [moduleName, entries] of Object.entries(REMOVED_EXPORTS)) {
    const used = stubbedAnywhere.get(moduleName) ?? new Set<string>();
    for (const name of Object.keys(entries)) {
      if (!used.has(name)) {
        problems.push(
          `${moduleName}: the table has a stand-in for "${name}", but no 1.x entrypoint of that module lost it in 2.0. Delete the entry.`,
        );
      }
    }
  }
  return { diffs, problems };
}

/* -------------------------------------------------------------------------- */
/* type fixtures                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The type fixtures: 1.x code that uses removed exports, compiled against the
 * built declarations. Each `@ts-expect-error <text>` comment names text that
 * the error on the next line must contain, next to REMOVED_MESSAGE.
 */
export const TYPE_FIXTURES = SCOPES.map((scope) =>
  path.join(
    repoRoot,
    scope.directory,
    "type-fixtures/removed-exports/tsconfig.json",
  ),
);

const EXPECT_ERROR = /\/\/\s*@ts-expect-error\s+(.+?)\s*$/;

/**
 * Text of each removal message. An error must show it, so that a type error
 * prints the whole message and not only the parts that build it.
 */
export const REMOVED_MESSAGE = "was removed in CopilotKit 2.0.";

/**
 * Compiles the type fixture `configFile` with each `@ts-expect-error` turned
 * off, and returns the problems: an expected error without its text or
 * without REMOVED_MESSAGE, and an error on a line without a
 * `@ts-expect-error`. Build the package first.
 */
export function typeFixtureProblems(configFile: string) {
  const parsed = ts.getParsedCommandLineOfConfigFile(configFile, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      );
    },
  });
  if (!parsed) throw new Error(`Cannot read ${configFile}.`);
  const fixtures = new Set(parsed.fileNames.map((file) => path.resolve(file)));
  const host = ts.createCompilerHost(parsed.options);
  const getSourceFile = host.getSourceFile.bind(host);
  // Without the directive, the error is reported, so its text can be read.
  host.getSourceFile = (file, languageVersion, ...rest) => {
    if (!fixtures.has(path.resolve(file))) {
      return getSourceFile(file, languageVersion, ...rest);
    }
    const text = readFileSync(file, "utf8").replaceAll(
      "@ts-expect-error",
      "expected error:",
    );
    return ts.createSourceFile(file, text, languageVersion, true);
  };
  const program = ts.createProgram(parsed.fileNames, parsed.options, host);
  const problems: string[] = [];
  for (const file of fixtures) {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`${file} is not in the program.`);
    const lines = readFileSync(file, "utf8").split("\n");
    const expected = new Map<number, string>();
    lines.forEach((line, index) => {
      const text = EXPECT_ERROR.exec(line)?.[1];
      if (text !== undefined) expected.set(index + 1, text);
    });
    const errors = new Map<number, string[]>();
    const diagnostics = [
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
    ];
    for (const diagnostic of diagnostics) {
      const line = source.getLineAndCharacterOfPosition(
        diagnostic.start ?? 0,
      ).line;
      const messages = errors.get(line) ?? [];
      messages.push(
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      );
      errors.set(line, messages);
    }
    const where = path.relative(repoRoot, file);
    for (const [line, text] of expected) {
      const messages = errors.get(line) ?? [];
      const hasMessage = messages.some(
        (message) =>
          message.includes(text) && message.includes(REMOVED_MESSAGE),
      );
      if (!hasMessage) {
        problems.push(
          `${where}:${line + 1}: expected an error with "${text}", got ${JSON.stringify(messages)}`,
        );
      }
    }
    for (const [line, messages] of errors) {
      if (!expected.has(line)) {
        problems.push(
          `${where}:${line + 1}: unexpected error ${JSON.stringify(messages)}`,
        );
      }
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* report                                                                     */
/* -------------------------------------------------------------------------- */

function report() {
  const v1 = readV1Exports();
  const { diffs, problems } = compareWithBuilds();
  for (const diff of diffs) {
    if (diff.removed.length === 0) {
      console.log(`${diff.importPath}: 2.0 removed nothing.`);
      continue;
    }
    const stubs = new Map(
      stubsOf(diff.module, v1).map((stub) => [stub.name, stub.info]),
    );
    const values = diff.stubbed.filter(
      (name) => stubs.get(name)?.kind !== "type",
    );
    console.log(
      `${diff.importPath}: ${diff.removed.length} removed, ${diff.stubbed.length} stand-ins (${values.length} values, ${diff.stubbed.length - values.length} types), ${Object.keys(diff.notStubbed).length} without one`,
    );
    for (const [name, reason] of Object.entries(diff.notStubbed)) {
      console.log(`  - ${name}: ${reason}`);
    }
  }
  for (const problem of problems) console.error(`PROBLEM: ${problem}`);
  if (problems.length > 0) process.exitCode = 1;
}

function check() {
  const stale = staleStubModules();
  for (const file of stale) {
    console.error(`${file} is out of date. Run generate.`);
  }
  const missing = missingDocsSections();
  for (const section of missing) {
    console.error(`No docs heading for ${section}.`);
  }
  const isBuilt = SCOPES.every((scope) =>
    existsSync(path.join(repoRoot, scope.directory, "dist")),
  );
  if (!isBuilt) {
    console.log("The packages are not built: skipped the check of the builds.");
  }
  const problems = isBuilt
    ? [
        ...compareWithBuilds().problems,
        ...TYPE_FIXTURES.flatMap((fixture) => typeFixtureProblems(fixture)),
      ]
    : [];
  for (const problem of problems) console.error(problem);
  const failures = stale.length + missing.length + problems.length;
  if (failures > 0) process.exitCode = 1;
}

const commands: Record<string, () => void> = {
  pack,
  generate,
  check,
  report,
};

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  const command = commands[process.argv[2] ?? ""];
  if (!command) {
    throw new Error(
      `Usage: removed-exports.mts ${Object.keys(commands).join(" | ")}`,
    );
  }
  command();
}
