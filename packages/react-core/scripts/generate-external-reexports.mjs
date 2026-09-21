// Generates src/v2/external-reexports.ts: the explicit named re-export list for
// the two external packages the v2 entry republishes.
//
// Why this exists, rather than `export * from "@copilotkit/core"`:
// `src/v2/index.ts` is a `"use client"` module. A bundler that builds the
// React server/client boundary has to enumerate a client module's exports one
// by one. It can flatten a star re-export of an *internal* module, because that
// module is in the graph, but `@copilotkit/core` and `@ag-ui/client` are
// external, so their stars survive into `dist/v2/index.mjs` and Next.js refuses
// the module with:
//
//   It's currently unsupported to use "export *" in a client boundary.
//   Please use named exports instead.
//
// Listing the names explicitly keeps the published entry enumerable, so the
// provider can be imported straight into a server component.
//
// Run: node scripts/generate-external-reexports.mjs [--check]
// The generated file is committed; `--check` fails when it is out of date.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const entryFile = path.join(packageDir, "src/v2/index.ts");
const outputFile = path.join(packageDir, "src/v2/external-reexports.ts");
const outputSpecifier = "./external-reexports";

/**
 * The packages whose surface the v2 entry republishes wholesale. Order matters:
 * it is the order the star re-exports appeared in, and it decides nothing else,
 * because a name exported by both packages is dropped (see `ambiguous` below).
 */
const EXTERNAL_PACKAGES = ["@copilotkit/core", "@ag-ui/client"];

const configPath = path.join(packageDir, "tsconfig.json");
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  packageDir,
);

const program = ts.createProgram([entryFile], {
  ...parsedConfig.options,
  noEmit: true,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();

const moduleExports = (fileName) => {
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) {
    throw new Error(`could not load module: ${fileName}`);
  }
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    throw new Error(`not a module: ${fileName}`);
  }
  return checker.getExportsOfModule(moduleSymbol);
};

const resolve = (specifier) => {
  const resolved = ts.resolveModuleName(
    specifier,
    entryFile,
    program.getCompilerOptions(),
    ts.sys,
  );
  if (!resolved.resolvedModule) {
    throw new Error(`could not resolve: ${specifier}`);
  }
  return resolved.resolvedModule.resolvedFileName;
};

/**
 * True when the name carries a runtime value (class, function, const, enum).
 * A name that is only a type has to be re-exported with `export type`, because
 * the package builds under `isolatedModules`.
 */
const hasValueMeaning = (symbol) => {
  let resolved = symbol;
  if (resolved.flags & ts.SymbolFlags.Alias) {
    try {
      resolved = checker.getAliasedSymbol(resolved);
    } catch {
      // An alias that cannot be followed is treated as a value, which is the
      // safe direction: a value re-export of a type is a compile error we would
      // see immediately, whereas the reverse silently drops the runtime binding.
      return true;
    }
  }
  return Boolean(resolved.flags & ts.SymbolFlags.Value);
};

// Everything the entry exports on its own account: its local modules, plus the
// names it declares or re-exports by hand. These shadow the star re-exports
// today, so they must stay out of the generated list or the same name would be
// exported twice.
const entrySource = program.getSourceFile(entryFile);
if (!entrySource) throw new Error(`could not load entry: ${entryFile}`);

const localNames = new Set();
const isExported = (statement) =>
  Boolean(ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export);

for (const statement of entrySource.statements) {
  // `export const x = ...`, `export function x() {}`, `export class X {}`, and
  // the type-only equivalents: the entry declares the name itself.
  if (!ts.isExportDeclaration(statement)) {
    if (!isExported(statement)) continue;
    if (statement.name && ts.isIdentifier(statement.name)) {
      localNames.add(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name))
          localNames.add(declaration.name.text);
      }
      continue;
    }
    // Anything else exported from the entry is a form this script has never
    // seen. Stop rather than guess: guessing wrong silently drops a name from
    // the generated list, which is the failure this whole file exists to avoid.
    throw new Error(
      `unhandled exported statement in ${path.relative(packageDir, entryFile)} ` +
        `at line ${entrySource.getLineAndCharacterOfPosition(statement.pos).line + 1}. ` +
        "Teach generate-external-reexports.mjs about it.",
    );
  }

  const specifier = statement.moduleSpecifier?.text;
  if (specifier && EXTERNAL_PACKAGES.includes(specifier)) continue;
  if (specifier === outputSpecifier) continue;

  if (statement.exportClause) {
    // `export { a, b } from "./x"` and `export { a, b }`.
    if (ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        localNames.add(element.name.text);
      }
      continue;
    }
    // `export * as ns from "./x"` exports ONE name, the namespace. Walking the
    // module's exports here would wrongly treat every name inside it as taken
    // by the entry, and quietly drop those names from the generated list.
    if (ts.isNamespaceExport(statement.exportClause)) {
      localNames.add(statement.exportClause.name.text);
      continue;
    }
    throw new Error(
      `unhandled export clause in ${path.relative(packageDir, entryFile)}. ` +
        "Teach generate-external-reexports.mjs about it.",
    );
  }

  // `export * from "./components"` and friends.
  if (!specifier) continue;
  for (const symbol of moduleExports(resolve(specifier))) {
    localNames.add(symbol.getName());
  }
}

const surfaces = EXTERNAL_PACKAGES.map((specifier) => ({
  specifier,
  symbols: moduleExports(resolve(specifier)),
}));

// A name exported by two star re-exports at once is ambiguous, and ES module
// semantics drop it rather than pick one. Reproduce that, so replacing the
// stars does not quietly add a name the entry never exported.
const nameCounts = new Map();
for (const surface of surfaces) {
  for (const symbol of surface.symbols) {
    const name = symbol.getName();
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
}

const sections = surfaces.map(({ specifier, symbols }) => {
  const values = [];
  const types = [];
  for (const symbol of symbols) {
    const name = symbol.getName();
    if (name === "default") continue; // `export *` never re-exports default
    if (localNames.has(name)) continue; // the entry's own export wins
    if (nameCounts.get(name) > 1) continue; // ambiguous across packages
    (hasValueMeaning(symbol) ? values : types).push(name);
  }
  values.sort();
  types.sort();
  return { specifier, values, types };
});

const renderList = (keyword, names, specifier) =>
  `export ${keyword}{\n${names.map((name) => `  ${name},`).join("\n")}\n} from "${specifier}";\n`;

let output = `// GENERATED FILE — DO NOT EDIT BY HAND.
// Regenerate with: pnpm --filter @copilotkit/react-core generate:external-reexports
//
// The v2 entry is a "use client" module, and a client module's exports have to
// be enumerable for the React server/client boundary to build. A star
// re-export of an external package is not, so the names are listed here
// instead. See scripts/generate-external-reexports.mjs.
`;

for (const { specifier, values, types } of sections) {
  output += `\n// ${specifier}\n`;
  if (values.length) output += renderList("", values, specifier);
  if (types.length) output += `\n${renderList("type ", types, specifier)}`;
}

const check = process.argv.includes("--check");
const current = fs.existsSync(outputFile)
  ? fs.readFileSync(outputFile, "utf8")
  : null;

if (check) {
  if (current !== output) {
    console.error(
      `${path.relative(process.cwd(), outputFile)} is out of date.\n` +
        "Run: pnpm --filter @copilotkit/react-core generate:external-reexports",
    );
    process.exit(1);
  }
  console.log("external re-exports are up to date.");
} else {
  fs.writeFileSync(outputFile, output);
  const total = sections.reduce(
    (sum, s) => sum + s.values.length + s.types.length,
    0,
  );
  console.log(
    `wrote ${path.relative(process.cwd(), outputFile)} — ${total} names from ${sections.length} packages.`,
  );
}
