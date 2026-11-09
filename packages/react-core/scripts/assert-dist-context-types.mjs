#!/usr/bin/env node
/**
 * Fails the build if the built declarations of
 * `@copilotkit/react-core/v2/generative-ui/native` or `/v2/headless` use a
 * `CopilotKitCoreReact` other than the one `/v2/context` exports.
 *
 * The class has private members, so TypeScript compares it nominally: two
 * declarations of it are not assignable to each other. A consumer that holds
 * the instance from `/v2/context` (the React Native provider does) and hands
 * it to one of those entries gets a type error if the entry's declarations
 * bundle the class into a chunk. The ESM and the CommonJS declarations are
 * emitted by separate passes, so each module mode is checked.
 *
 * Two checks run, each on the `.d.cts` and on the `.d.mts` files:
 *
 * 1. Declaration walk (TypeScript compiler API). For every export of the
 *    native and headless entries, it follows the declarations inside `dist/`
 *    and collects each copy of the class that the export reaches: a class
 *    named `CopilotKitCoreReact` (or a renamed copy such as
 *    `CopilotKitCoreReact$1` or `CopilotKitCoreReact_1`), or any class with
 *    the same private members. Every such class must be the one `/v2/context`
 *    exports, wherever that one is declared (`context.d.*` or a shared chunk).
 *    A relative or self-referencing import in those declarations that does
 *    not resolve is reported too, since the type it names becomes `any`.
 *    Every native export that reaches the class must be imported by the
 *    consumers below, so that a new export cannot go unchecked; and every
 *    name the consumers import from the native entry must still be exported
 *    and still reach the class, so that a stale import cannot pass unchecked.
 * 2. Consumers (`tsc` on `dist-context-types/consumer.{cts,mts}`). They
 *    import the built package by name and pass the `/v2/context` instance to
 *    those native exports and to the headless class. Negative probes
 *    (`@ts-expect-error`) make the check fail if a type resolved to `any`,
 *    which `skipLibCheck` would otherwise let through.
 *
 * The rest of the two entries' declarations is not type-checked here.
 *
 * Tests: scripts/__tests__/assert-dist-context-types.test.mjs.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const NAME = "assert-dist-context-types";
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
// Real paths: TypeScript reports the files it reads by their real path.
const packageDir = fs.realpathSync(path.resolve(here, ".."));
const distDir = path.join(packageDir, "dist");
const consumerDir = path.join(packageDir, "scripts", "dist-context-types");
const project = path.join(consumerDir, "tsconfig.json");

const fail = (message) => {
  console.error(`${NAME}: ${message}`);
  process.exit(1);
};
const rel = (file) => path.relative(packageDir, file);

// tsc takes a few seconds here. The limit only keeps a hung tsc from hanging
// the build without a word.
const TIMEOUT_ENV = "ASSERT_DIST_CONTEXT_TYPES_TIMEOUT_MS";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const TIMEOUT_MS = (() => {
  const raw = process.env[TIMEOUT_ENV];
  if (raw === undefined || raw.trim() === "") return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  if (!/^\s*\d+\s*$/.test(raw) || !Number.isSafeInteger(value) || value <= 0) {
    fail(
      `${TIMEOUT_ENV} must be a positive whole number of milliseconds, got ` +
        `${JSON.stringify(raw)}. Unset it for the default (${DEFAULT_TIMEOUT_MS} ms).`,
    );
  }
  return value;
})();
// tsc's output is read whole. A dump larger than this stops tsc (ENOBUFS).
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
// Lines of tsc's output quoted in a failure message.
const QUOTED_LINES = 200;

const PACKAGE = "@copilotkit/react-core";
const CONTEXT = `${PACKAGE}/v2/context`;
const NATIVE = `${PACKAGE}/v2/generative-ui/native`;
const HEADLESS = `${PACKAGE}/v2/headless`;
const CLASS = "CopilotKitCoreReact";
// The class under its own name or a bundler's rename of it.
const CLASS_NAME = /^_*CopilotKitCoreReact(?:[$_]\d+)?$/;
const MODES = {
  cts: {
    label: "CommonJS (.d.cts)",
    consumer: path.join(consumerDir, "consumer.cts"),
  },
  mts: {
    label: "ESM (.d.mts)",
    consumer: path.join(consumerDir, "consumer.mts"),
  },
};

const quote = (output) => {
  const lines = output.split("\n");
  return lines.length <= QUOTED_LINES
    ? output
    : `${lines.slice(0, QUOTED_LINES).join("\n")}\n... (${lines.length - QUOTED_LINES} more lines)`;
};

// ---------------------------------------------------------------------------
// TypeScript
let ts;
let tsc;
try {
  ts = require("typescript");
  tsc = require.resolve("typescript/bin/tsc");
} catch (error) {
  fail(
    `cannot load the \`typescript\` package from ${here} (${error.message.split("\n")[0]}).\n` +
      "It is a devDependency of @copilotkit/react-core: run `pnpm install` at the repository root.",
  );
}

// ---------------------------------------------------------------------------
// The built declarations must exist. A missing file is a build problem, not a
// type problem.
const required = [
  "v2/context",
  "v2/headless",
  "v2/generative-ui/native",
].flatMap((entry) =>
  Object.keys(MODES).map((ext) => path.join(distDir, `${entry}.d.${ext}`)),
);
const missing = required.filter((file) => !fs.existsSync(file));
if (missing.length > 0) {
  fail(
    "the built declarations are missing:\n" +
      missing.map((file) => `  ${rel(file)}\n`).join("") +
      "This script checks the build output. Build first: " +
      "`npx nx run @copilotkit/react-core:build`.",
  );
}
const missingInputs = [project, ...Object.values(MODES).map((m) => m.consumer)]
  .filter((file) => !fs.existsSync(file))
  .map((file) => `  ${rel(file)}\n`);
if (missingInputs.length > 0) {
  fail(
    "the consumers this script type-checks are missing:\n" +
      missingInputs.join("") +
      "Restore them (git checkout) or update the paths in this script.",
  );
}

const problems = [];
const hints = new Set();
// Set when tsc itself failed (could not start, was killed, timed out).
let tscDidNotRun = false;

const identityHint = (ext) =>
  ext === "cts"
    ? "CommonJS: tsdown emits the `.d.cts` files in a pass of their own that leaves out the " +
      "config's `plugins`, so `externalizeContext` reaches it only through " +
      "`inputOptions: externalizeContextInCjsDts(...)` in tsdown.config.ts. In the main build " +
      "the hook takes an `onlyFrom` regex that must match the declaration module of the " +
      "entry that exports the class (today `src/v2/generative-ui/native.d.ts`). Widen that " +
      "regex if a new module needs it, but keep the filter: the main build's CommonJS " +
      "declarations also serve the root `.` entry, which `moduleResolution: node10` reads " +
      "and which cannot resolve the `/v2/context` subpath (attw: InternalResolutionError). " +
      "The headless build runs the hook with no filter."
    : "ESM: the `.d.mts` files take the config's `plugins`, so check that the build lists " +
      "`externalizeContext` in `plugins` and `@copilotkit/react-core/v2/context` in `external`.";
const annotationHint =
  "An export of the native entry must name the `CopilotKitCoreReact` that it imports from " +
  "`../context` in its own declaration (see `useGenerativeUIRoot` in " +
  "src/v2/generative-ui/native.ts). Re-exported from a module that imports the class from " +
  "`../lib/react-core`, it is declared with the bundled copy.";

// ---------------------------------------------------------------------------
// Check 1: the declaration walk.
const formatHost = {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => packageDir,
  getNewLine: () => "\n",
};
const formatDiagnostics = (diagnostics) =>
  ts.formatDiagnostics(diagnostics, formatHost).trim();
const parsed = ts.getParsedCommandLineOfConfigFile(
  project,
  {},
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) =>
      fail(`cannot read ${rel(project)}:\n${formatDiagnostics([d])}`),
  },
);
if (!parsed) fail(`cannot read ${rel(project)}.`);
if (parsed.errors.length > 0) {
  fail(
    `${rel(project)} has errors, so the check cannot run:\n` +
      formatDiagnostics(parsed.errors),
  );
}
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const inDist = (file) => path.resolve(file).startsWith(distDir + path.sep);

const resolveAlias = (symbol) =>
  symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;

// The names of a class's private members, sorted: the same set means a copy
// of the same class, whatever the bundler renamed it to.
const privateMembers = (symbol) => {
  const names = new Set();
  for (const declaration of symbol.declarations ?? []) {
    if (!ts.isClassLike(declaration)) continue;
    for (const member of declaration.members) {
      if (!member.name) continue;
      if (ts.isPrivateIdentifier(member.name)) names.add(member.name.text);
      else if (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Private)
        names.add(member.name.getText());
    }
  }
  return [...names].sort().join(",");
};

const isSelfOrRelative = (specifier) =>
  specifier.startsWith(".") ||
  specifier === PACKAGE ||
  specifier.startsWith(`${PACKAGE}/`);

// Relative or self-referencing module specifiers in a declaration file that
// do not resolve. Cached per file.
const unresolvedCache = new Map();
const unresolvedImports = (sourceFile) => {
  if (unresolvedCache.has(sourceFile)) return unresolvedCache.get(sourceFile);
  const found = [];
  const check = (literal) => {
    if (!literal || !ts.isStringLiteralLike(literal)) return;
    if (!isSelfOrRelative(literal.text)) return;
    if (!checker.getSymbolAtLocation(literal)) found.push(literal.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      check(node.moduleSpecifier);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      check(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  unresolvedCache.set(sourceFile, found);
  return found;
};

// The copies of the class that a symbol's declarations in `dist/` reach,
// through any chain of types they reference, and the declaration files the
// walk read.
const reach = (start, isCopy) => {
  const classes = new Set();
  const files = new Set();
  const seen = new Set();
  const visit = (raw) => {
    const symbol = resolveAlias(raw);
    if (seen.has(symbol)) return;
    seen.add(symbol);
    if (symbol.flags & ts.SymbolFlags.Class && isCopy(symbol)) {
      classes.add(symbol);
      return;
    }
    for (const declaration of symbol.declarations ?? []) {
      const sourceFile = declaration.getSourceFile();
      if (!inDist(sourceFile.fileName)) continue;
      files.add(sourceFile);
      walk(declaration);
    }
  };
  const walk = (node) => {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol) visit(symbol);
    }
    ts.forEachChild(node, walk);
  };
  visit(start);
  return { classes, files };
};

// For each module a consumer imports: its symbol, the export names the
// consumer uses, and the local names it binds. Every import declaration of a
// specifier counts. A default import counts as `default`; a namespace import
// counts the members the file reads through it.
const consumerImports = (consumer) => {
  const source = program.getSourceFile(consumer);
  if (!source) {
    fail(
      `${rel(consumer)} is not part of ${rel(project)}: list it in its \`files\`.`,
    );
  }
  const imports = new Map();
  const namespaces = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!imports.has(specifier)) {
      imports.set(specifier, {
        module: undefined,
        names: new Set(),
        locals: new Set(),
      });
    }
    const entry = imports.get(specifier);
    entry.module ??= checker.getSymbolAtLocation(statement.moduleSpecifier);
    const clause = statement.importClause;
    if (clause?.name) {
      entry.names.add("default");
      entry.locals.add(clause.name.text);
    }
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        entry.names.add((element.propertyName ?? element.name).text);
        entry.locals.add(element.name.text);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      entry.locals.add(bindings.name.text);
      namespaces.set(checker.getSymbolAtLocation(bindings.name), entry);
    }
  }
  if (namespaces.size > 0) {
    const visit = (node) => {
      let target;
      let member;
      if (ts.isPropertyAccessExpression(node)) {
        target = node.expression;
        member = node.name.text;
      } else if (
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression)
      ) {
        target = node.expression;
        member = node.argumentExpression.text;
      } else if (ts.isQualifiedName(node)) {
        target = node.left;
        member = node.right.text;
      }
      if (target && ts.isIdentifier(target)) {
        const entry = namespaces.get(checker.getSymbolAtLocation(target));
        if (entry) entry.names.add(member);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { source, imports };
};

const consumers = {};
for (const [ext, mode] of Object.entries(MODES)) {
  const { source, imports } = consumerImports(mode.consumer);
  consumers[ext] = { source, imports };

  // The class `/v2/context` exports: the one every entry must use.
  const context = imports.get(CONTEXT);
  if (!context?.module) {
    problems.push(
      `${mode.label}: ${rel(mode.consumer)} must import \`${CLASS}\` from ${CONTEXT}, ` +
        "and the import must resolve (see check 2).",
    );
    continue;
  }
  const exportedClass = checker
    .getExportsOfModule(context.module)
    .find((symbol) => symbol.name === CLASS);
  const canonical = exportedClass && resolveAlias(exportedClass);
  if (!canonical?.declarations?.length) {
    problems.push(
      `${mode.label}: ${CONTEXT} does not export a resolvable \`${CLASS}\`.`,
    );
    continue;
  }
  const canonicalFiles = canonical.declarations.map(
    (d) => d.getSourceFile().fileName,
  );
  const signature = privateMembers(canonical);
  const isCopy = (symbol) =>
    symbol === canonical ||
    CLASS_NAME.test(symbol.name) ||
    (signature !== "" && privateMembers(symbol) === signature);

  for (const entry of [NATIVE, HEADLESS]) {
    const imported = imports.get(entry);
    if (!imported?.module) {
      problems.push(
        `${mode.label}: ${rel(mode.consumer)} does not resolve ${entry} (see check 2).`,
      );
      continue;
    }
    const entryFiles = new Set(
      (imported.module.declarations ?? []).map((d) => d.getSourceFile()),
    );
    const exportNames = new Set();
    const carriers = [];
    for (const exported of checker.getExportsOfModule(imported.module)) {
      exportNames.add(exported.name);
      const { classes, files } = reach(exported, isCopy);
      for (const file of files) entryFiles.add(file);
      if (classes.size === 0) continue;
      carriers.push(exported.name);
      for (const cls of classes) {
        if (cls === canonical) continue;
        const declaredIn = (cls.declarations ?? []).map(
          (d) => d.getSourceFile().fileName,
        );
        problems.push(
          `${mode.label}: \`${exported.name}\` of ${entry} uses a second declaration of ` +
            `the class, \`${cls.name}\` in ${declaredIn.map(rel).join(", ")}, not the one ` +
            `${CONTEXT} exports (declared in ${canonicalFiles.map(rel).join(", ")}).`,
        );
        hints.add(identityHint(ext));
        if (entry === NATIVE) hints.add(annotationHint);
      }
    }
    for (const file of entryFiles) {
      if (!inDist(file.fileName)) continue;
      for (const specifier of unresolvedImports(file)) {
        problems.push(
          `${mode.label}: ${entry}: "${specifier}" in ${rel(file.fileName)} does not ` +
            "resolve. The types it names become `any` (`skipLibCheck` hides the error), so " +
            "this check cannot see which class they use. Check that the build emitted the " +
            "file and that the `exports` map of package.json lists the subpath.",
        );
      }
    }
    if (entry !== NATIVE) continue;
    const unchecked = carriers.filter((name) => !imported.names.has(name));
    if (unchecked.length > 0) {
      problems.push(
        `${mode.label}: these exports of ${entry} take or return ${CLASS}, but ` +
          `${rel(mode.consumer)} does not check them: ${unchecked.join(", ")}. Import each ` +
          "one in both consumers and pass it the `/v2/context` instance (`core`).",
      );
    }
    const stale = [...imported.names].filter(
      (name) => !carriers.includes(name),
    );
    const gone = stale.filter((name) => !exportNames.has(name));
    const lost = stale.filter((name) => exportNames.has(name));
    if (gone.length > 0) {
      problems.push(
        `${mode.label}: ${rel(mode.consumer)} imports ${gone.join(", ")} from ${entry}, ` +
          "which no longer exports it. If it was removed or renamed, update both consumers.",
      );
    }
    if (lost.length > 0) {
      problems.push(
        `${mode.label}: ${rel(mode.consumer)} imports ${lost.join(", ")} from ${entry}, ` +
          `but the built declaration of it does not reach ${CLASS}. Either its ` +
          "signature no longer takes the class (drop it from the consumers), or the " +
          "declaration lost the type: an import in the `.d.*` files that does not resolve " +
          "turns it into `any`, and `skipLibCheck` hides the error.",
      );
    }
  }
}

// Whether a consumer line that tsc flags uses a native export (so the
// native-only annotation hint applies). Unknown lines count as native.
const usesNative = (ext, line, column) => {
  const consumer = consumers[ext];
  const locals = consumer?.imports.get(NATIVE)?.locals;
  if (!locals) return true;
  const { source } = consumer;
  if (line > source.getLineStarts().length) return true;
  const position = ts.getPositionOfLineAndCharacter(
    source,
    line - 1,
    Math.max(0, column - 1),
  );
  const statement = source.statements.find(
    (s) => s.getStart(source) <= position && position < s.getEnd(),
  );
  if (!statement) return true;
  let found = false;
  const visit = (node) => {
    if (ts.isIdentifier(node) && locals.has(node.text)) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
};

// ---------------------------------------------------------------------------
// Check 2: tsc on the consumers.
const result = spawnSync(
  process.execPath,
  [tsc, "-p", project, "--pretty", "false"],
  {
    cwd: packageDir,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
  },
);
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();

if (result.error?.code === "ENOBUFS") {
  problems.push(
    `tsc on scripts/dist-context-types printed more than ${MAX_OUTPUT_BYTES} bytes and ` +
      "was stopped. That many errors is a real failure, not a flaky run: running again " +
      `gives the same result. See the start of it with \`node ${tsc} -p ${project} ` +
      "--pretty false | head -50`." +
      (output ? `\nIts first lines:\n${quote(output)}` : ""),
  );
} else if (result.error || result.signal) {
  const why = result.error
    ? result.error.code === "ETIMEDOUT"
      ? `did not finish within ${TIMEOUT_MS} ms and was stopped (raise ${TIMEOUT_ENV} if it is just slow)`
      : `could not run (${result.error.message})`
    : `was killed by ${result.signal}`;
  tscDidNotRun = true;
  problems.push(
    `tsc (${tsc}) ${why}. This says nothing about the declarations; run ` +
      `\`node ${rel(path.join(here, "assert-dist-context-types.mjs"))}\` again.` +
      (output ? `\nIts output so far:\n${quote(output)}` : ""),
  );
} else if (result.status !== 0 && output === "") {
  problems.push(
    `tsc on scripts/dist-context-types exited with status ${result.status} and printed ` +
      `nothing, so there is no diagnostic to report. Run \`node ${tsc} -p ${project}\` ` +
      "to see what it does.",
  );
} else if (result.status !== 0) {
  // Split tsc's output into diagnostics: a header line (`file(l,c): error TS…`,
  // or `error TS…` for one without a file location) plus indented details.
  const HEADER = /^(?:\S.*\(\d+,\d+\): )?error TS\d+/;
  const diagnostics = [];
  for (const line of output.split("\n")) {
    if (HEADER.test(line) || diagnostics.length === 0) {
      diagnostics.push(line);
    } else {
      diagnostics[diagnostics.length - 1] += `\n${line}`;
    }
  }
  const causes = new Set();
  for (const diagnostic of diagnostics) {
    const at = /consumer\.(cts|mts)\((\d+),(\d+)\)/.exec(diagnostic);
    if (/^error TS\d+/.test(diagnostic)) {
      causes.add("global");
    } else if (/separate declarations of a private property/.test(diagnostic)) {
      causes.add("identity");
      if (at) hints.add(identityHint(at[1]));
      if (!at || usesNative(at[1], Number(at[2]), Number(at[3])))
        hints.add(annotationHint);
    } else if (/error TS2578/.test(diagnostic)) {
      causes.add("any");
    } else if (/error TS(2307|7016)/.test(diagnostic)) {
      causes.add("unresolved");
    } else {
      causes.add("other");
    }
  }
  const explain = {
    identity:
      "the `/v2/context` instance is not assignable to a native or headless export: the " +
      "entry's declarations use a second declaration of CopilotKitCoreReact.",
    any:
      "a negative probe (`@ts-expect-error`) no longer errors: a type it uses resolved to " +
      "`any`. An import in the built `.d.*` files likely does not resolve; `skipLibCheck` " +
      "hides that error.",
    unresolved:
      "a consumer cannot resolve an entry's declarations. Check the `exports` map of " +
      "package.json and that the build emitted the file.",
    global:
      "tsc reported an error with no file location: a compiler option or tsconfig problem " +
      "in scripts/dist-context-types, not a type error in the declarations.",
    other:
      "a consumer no longer type-checks against the built entry, for a reason other than " +
      "the class identity (an export was renamed, or its signature changed?). Update " +
      "scripts/dist-context-types/consumer.{cts,mts}.",
  };
  problems.push(
    "tsc on scripts/dist-context-types failed:\n" +
      [...causes].map((cause) => `  - ${explain[cause]}\n`).join("") +
      `\n${quote(output)}`,
  );
}

if (problems.length > 0) {
  fail(
    (tscDidNotRun && problems.length === 1
      ? "the check did not complete.\n\n"
      : "the built declarations failed the check.\n\n") +
      problems.map((problem) => `* ${problem}`).join("\n\n") +
      (hints.size > 0
        ? "\n\nFix:\n" + [...hints].map((hint) => `- ${hint}`).join("\n")
        : ""),
  );
}

console.log(
  `${NAME}: OK — the ESM and CommonJS declarations of the native and headless entries ` +
    "use the CopilotKitCoreReact of /v2/context.",
);
