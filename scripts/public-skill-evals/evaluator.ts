import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import ts from "typescript";

export interface ManifestEntrypoint {
  importPath: string;
}

export interface ManifestPackage {
  name: string;
  entrypoints: ManifestEntrypoint[];
}

export interface ManifestDeprecation {
  importPath: string;
  symbol: string;
  replacement: {
    importPath: string;
    symbol: string;
  };
  sourceMessage: string;
}

export interface PublicApiManifest {
  schemaVersion: 1;
  packages: ManifestPackage[];
  deprecations: ManifestDeprecation[];
}

export interface EvaluationSource {
  path: string;
  source: string;
}

export interface SkillEvaluationScenario {
  id: string;
  skill: string;
  sources: EvaluationSource[];
  requiredEntrypoints: string[];
}

export interface EvaluationDiagnostic {
  code:
    | "deprecated-api"
    | "typescript"
    | "unknown-entrypoint"
    | "unknown-package";
  file?: string;
  line?: number;
  column?: number;
  message: string;
}

export interface EvaluationResult {
  id: string;
  skill: string;
  passed: boolean;
  attempts: number;
  durationMs: number;
  diagnostics: EvaluationDiagnostic[];
}

export interface EvaluationSummary {
  total: number;
  passed: number;
  passRate: number;
  medianAttempts: number | null;
  medianTimeToGreenMs: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function loadManifest(root: string): PublicApiManifest {
  const manifestPath = resolve(
    root,
    "scripts/release/public-api/manifest.v1.json",
  );
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
    throw new Error(
      `${manifestPath}: expected public API manifest schemaVersion 1`,
    );
  }
  if (!Array.isArray(parsed.packages) || !Array.isArray(parsed.deprecations)) {
    throw new Error(
      `${manifestPath}: expected packages and deprecations arrays; regenerate the public API manifest`,
    );
  }

  return parsed as unknown as PublicApiManifest;
}

function packageNameForImport(importPath: string): string {
  return importPath.split("/").slice(0, 2).join("/");
}

function diagnosticLocation(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): Pick<EvaluationDiagnostic, "file" | "line" | "column"> {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return {
    file: sourceFile.fileName,
    line: position.line + 1,
    column: position.character + 1,
  };
}

function importedSymbols(clause: ts.ImportClause | undefined): string[] {
  const bindings = clause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) {
    return [];
  }
  return bindings.elements.map(
    (element) => element.propertyName?.text ?? element.name.text,
  );
}

export function validateManifestContracts(
  manifest: PublicApiManifest,
  scenario: SkillEvaluationScenario,
): EvaluationDiagnostic[] {
  const diagnostics: EvaluationDiagnostic[] = [];

  for (const source of scenario.sources) {
    const sourceFile = ts.createSourceFile(
      source.path,
      source.source,
      ts.ScriptTarget.Latest,
      true,
      extname(source.path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }

      const importPath = statement.moduleSpecifier.text;
      if (!importPath.startsWith("@copilotkit/")) {
        continue;
      }

      const packageName = packageNameForImport(importPath);
      const manifestPackage = manifest.packages.find(
        (candidate) => candidate.name === packageName,
      );
      const location = diagnosticLocation(
        sourceFile,
        statement.moduleSpecifier,
      );

      if (!manifestPackage) {
        diagnostics.push({
          code: "unknown-package",
          ...location,
          message: `"${packageName}" is not a package in manifest.v1.json; use a currently published @copilotkit package`,
        });
        continue;
      }

      if (
        !manifestPackage.entrypoints.some(
          (entrypoint) => entrypoint.importPath === importPath,
        )
      ) {
        diagnostics.push({
          code: "unknown-entrypoint",
          ...location,
          message: `"${importPath}" is not exported by ${packageName}; available entrypoints: ${manifestPackage.entrypoints
            .map((entrypoint) => entrypoint.importPath)
            .join(", ")}`,
        });
        continue;
      }

      for (const symbol of importedSymbols(statement.importClause)) {
        const deprecation = manifest.deprecations.find(
          (candidate) =>
            candidate.importPath === importPath && candidate.symbol === symbol,
        );
        if (!deprecation) {
          continue;
        }

        diagnostics.push({
          code: "deprecated-api",
          ...location,
          message: `${symbol} from "${importPath}" is deprecated; replace with ${deprecation.replacement.symbol} from "${deprecation.replacement.importPath}". ${deprecation.sourceMessage}`,
        });
      }
    }
  }

  for (const importPath of scenario.requiredEntrypoints) {
    const packageName = packageNameForImport(importPath);
    const manifestPackage = manifest.packages.find(
      (candidate) => candidate.name === packageName,
    );

    if (!manifestPackage) {
      diagnostics.push({
        code: "unknown-package",
        message: `"${packageName}" is not a package in manifest.v1.json; required by ${scenario.id}`,
      });
    } else if (
      !manifestPackage.entrypoints.some(
        (entrypoint) => entrypoint.importPath === importPath,
      )
    ) {
      diagnostics.push({
        code: "unknown-entrypoint",
        message: `"${importPath}" is not exported by ${packageName}; required by ${scenario.id}`,
      });
    }
  }

  return diagnostics;
}

function normalizePath(path: string): string {
  return resolve(path);
}

export function typecheckScenario(
  root: string,
  scenario: SkillEvaluationScenario,
): EvaluationDiagnostic[] {
  const virtualRoot = resolve(
    root,
    "scripts/public-skill-evals/.virtual",
    scenario.id,
  );
  const virtualSources = new Map(
    scenario.sources.map((source) => [
      normalizePath(resolve(virtualRoot, source.path)),
      source,
    ]),
  );
  const options: ts.CompilerOptions = {
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: ["node", "react"],
  };
  const host = ts.createCompilerHost(options);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultReadFile = host.readFile.bind(host);
  const defaultGetSourceFile = host.getSourceFile.bind(host);

  host.fileExists = (fileName) =>
    virtualSources.has(normalizePath(fileName)) || defaultFileExists(fileName);
  host.readFile = (fileName) =>
    virtualSources.get(normalizePath(fileName))?.source ??
    defaultReadFile(fileName);
  host.getSourceFile = (
    fileName,
    languageVersion,
    onError,
    shouldCreateNewSourceFile,
  ) => {
    const source = virtualSources.get(normalizePath(fileName));
    if (source) {
      return ts.createSourceFile(
        fileName,
        source.source,
        languageVersion,
        true,
        extname(source.path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
    }
    return defaultGetSourceFile(
      fileName,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    );
  };

  const program = ts.createProgram({
    rootNames: [...virtualSources.keys()],
    options,
    host,
  });

  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const source = diagnostic.file
      ? virtualSources.get(normalizePath(diagnostic.file.fileName))
      : undefined;
    const position =
      diagnostic.file && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        : undefined;

    return {
      code: "typescript" as const,
      file: source?.path ?? diagnostic.file?.fileName,
      line: position ? position.line + 1 : undefined,
      column: position ? position.character + 1 : undefined,
      message: `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
      )}`,
    };
  });
}

export function evaluateScenario(
  root: string,
  manifest: PublicApiManifest,
  scenario: SkillEvaluationScenario,
): EvaluationResult {
  const start = performance.now();
  const manifestDiagnostics = validateManifestContracts(manifest, scenario);
  const diagnostics =
    manifestDiagnostics.length > 0
      ? manifestDiagnostics
      : typecheckScenario(root, scenario);

  return {
    id: scenario.id,
    skill: scenario.skill,
    passed: diagnostics.length === 0,
    attempts: 1,
    durationMs: Math.round(performance.now() - start),
    diagnostics,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function summarizeResults(
  results: EvaluationResult[],
): EvaluationSummary {
  const passedResults = results.filter((result) => result.passed);
  return {
    total: results.length,
    passed: passedResults.length,
    passRate: results.length === 0 ? 0 : passedResults.length / results.length,
    medianAttempts: median(results.map((result) => result.attempts)),
    medianTimeToGreenMs: median(
      passedResults.map((result) => result.durationMs),
    ),
  };
}

export function formatDiagnostic(diagnostic: EvaluationDiagnostic): string {
  const location = diagnostic.file
    ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}${
        diagnostic.column ? `:${diagnostic.column}` : ""
      }`
    : undefined;
  return `${location ? `${location} ` : ""}[${diagnostic.code}] ${diagnostic.message}`;
}
