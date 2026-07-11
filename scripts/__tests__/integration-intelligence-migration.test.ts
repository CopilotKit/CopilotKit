import * as fs from "node:fs";
import * as path from "node:path";

import * as ts from "typescript";
import { expect, test } from "vitest";

const repoRoot = path.resolve(__dirname, "..", "..");
const integrationsDir = path.join(repoRoot, "examples", "integrations");

const MANAGED_API_KEY = "CPK_INTELLIGENCE_API_KEY";
const OPTIONAL_TELEMETRY_ID = "CPK_TELEMETRY_ID";
const LEGACY_API_KEY = "INTELLIGENCE_API_KEY";
const LEGACY_TELEMETRY_ID = "COPILOTKIT_TELEMETRY_ID";
const MANAGED_LICENSE_TOKEN = "COPILOTKIT_LICENSE_TOKEN";
const MANAGED_API_KEY_SECRET_CONFIG =
  "copilotkit_intelligence_api_key_secret_name";
const NEXT_THREADS_GATE = "NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED";
const VITE_THREADS_GATE = "VITE_COPILOTKIT_THREADS_ENABLED";
const MANAGED_DOCUMENTATION_LABEL = /\bmanaged\b/i;
const SELF_HOSTED_OR_OFFLINE_LABEL = /\b(?:self[ -]?hosted|offline)\b/i;
const LICENSE_GATING_LANGUAGE =
  /(?:\blicen[cs]e\b[\s\S]{0,160}\b(?:activat(?:e[sd]?|ing)|unlock(?:s|ed|ing)?|enabl(?:e[sd]?|ing))\b[\s\S]{0,160}\b(?:threads?|inspector)\b|\b(?:threads?|inspector)\b[\s\S]{0,160}\b(?:activat(?:e[sd]?|ing)|unlock(?:s|ed|ing)?|enabl(?:e[sd]?|ing))\b[\s\S]{0,160}\blicen[cs]e\b)/i;
const INTEGRATION_PARITY_WORKFLOW = path.join(
  repoRoot,
  ".github",
  "workflows",
  "integrations_parity.yml",
);

const MANAGED_CLI_FRAMEWORKS = [
  "langgraph-py",
  "langgraph-js",
  "claude-sdk-typescript",
  "claude-sdk-python",
  "flows",
  "mastra",
  "pydantic-ai",
  "llamaindex",
  "agno",
  "adk",
  "aws-strands-py",
  "a2a",
  "microsoft-agent-framework-dotnet",
  "microsoft-agent-framework-py",
  "mcp-apps",
  "agentcore-langgraph",
  "agentcore-strands",
  "a2ui",
  "opengenui",
] as const;

type ManagedCliFramework = (typeof MANAGED_CLI_FRAMEWORKS)[number];

interface ManagedTemplateContract {
  readonly directory: string;
  readonly frameworks: readonly ManagedCliFramework[];
  readonly runtimePath: string;
  readonly gatePath: string;
  readonly envPath: string;
  readonly readmePath: string;
  readonly supportedPaths?: {
    readonly localComposePath: string;
    readonly deploymentConfigPath: string;
    readonly runtimeDeploymentPath: string;
    readonly frontendDeploymentPath: string;
    readonly deployScriptPaths: readonly string[];
  };
}

const MANAGED_TEMPLATE_CONTRACTS = [
  {
    directory: "langgraph-python",
    frameworks: ["langgraph-py", "a2ui", "opengenui"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "langgraph-js",
    frameworks: ["langgraph-js"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "claude-sdk-typescript",
    frameworks: ["claude-sdk-typescript"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "claude-sdk-python",
    frameworks: ["claude-sdk-python"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "crewai-flows",
    frameworks: ["flows"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "mastra",
    frameworks: ["mastra"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "pydantic-ai",
    frameworks: ["pydantic-ai"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "llamaindex",
    frameworks: ["llamaindex"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "agno",
    frameworks: ["agno"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "adk",
    frameworks: ["adk"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "strands-python",
    frameworks: ["aws-strands-py"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "a2a-middleware",
    frameworks: ["a2a"],
    runtimePath: "app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "ms-agent-framework-dotnet",
    frameworks: ["microsoft-agent-framework-dotnet"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "ms-agent-framework-python",
    frameworks: ["microsoft-agent-framework-py"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "mcp-apps",
    frameworks: ["mcp-apps"],
    runtimePath: "app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
  },
  {
    directory: "agentcore",
    frameworks: ["agentcore-langgraph", "agentcore-strands"],
    runtimePath: "infra-cdk/lambdas/copilotkit-runtime/src/runtime.ts",
    gatePath: "frontend/vite.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
    supportedPaths: {
      localComposePath: "docker/docker-compose.yml",
      deploymentConfigPath: "config.yaml.example",
      runtimeDeploymentPath: "infra-cdk/lib/backend-stack.ts",
      frontendDeploymentPath: "infra-cdk/lib/amplify-hosting-stack.ts",
      deployScriptPaths: ["deploy-langgraph.sh", "deploy-strands.sh"],
    },
  },
] as const satisfies readonly ManagedTemplateContract[];

/**
 * Reads one required managed-template surface from its authoritative path.
 *
 * @param contract - Managed template and its exact surface paths.
 * @param relativePath - Surface path relative to the integration directory.
 * @param surface - Human-readable surface name used in assertion failures.
 * @returns The UTF-8 contents, or an empty string after a missing-file assertion.
 */
function readManagedSurface(
  contract: ManagedTemplateContract,
  relativePath: string,
  surface: string,
): string {
  const filePath = path.join(integrationsDir, contract.directory, relativePath);
  const exists = fs.existsSync(filePath);

  expect(
    exists,
    `${contract.directory} ${surface} must exist at ${relativePath}`,
  ).toBe(true);

  return exists ? fs.readFileSync(filePath, "utf8") : "";
}

/**
 * Returns one two-space-indented YAML mapping section.
 *
 * @param contents - YAML source containing service-style mappings.
 * @param name - Mapping key whose complete section should be returned.
 * @returns The mapping section, or an empty string when it is absent.
 */
function yamlMappingSection(contents: string, name: string): string {
  const lines = contents.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start < 0) {
    return "";
  }

  const relativeEnd = lines
    .slice(start + 1)
    .findIndex((line) => /^  [^\s].*:\s*$/.test(line));
  const end = relativeEnd < 0 ? lines.length : start + relativeEnd + 1;
  return lines.slice(start, end).join("\n");
}

/** Matches a service-level reference to the generated project's root env. */
function rootManagedEnvFilePattern(): RegExp {
  return /env_file:\s*(?:\r?\n\s*-\s*)?\.\.\/\.env\b/;
}

/**
 * Matches an environment identifier without matching it inside a longer name.
 *
 * @param identifier - Exact uppercase environment identifier to match.
 * @returns A pattern that excludes surrounding uppercase identifier characters.
 */
function exactEnvIdentifierPattern(identifier: string): RegExp {
  return new RegExp(`(^|[^A-Z0-9_])${identifier}([^A-Z0-9_]|$)`);
}

/** Returns whether a node is the `process.env` object expression. */
function isProcessEnvObject(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "process" &&
    node.name.text === "env"
  );
}

/**
 * Returns whether a node is a dot or bracket read from `process.env`.
 *
 * @param node - TypeScript syntax node under inspection.
 * @param identifier - Exact environment identifier that must be read.
 */
function isProcessEnvRead(node: ts.Node, identifier: string): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return isProcessEnvObject(node.expression) && node.name.text === identifier;
  }

  return (
    ts.isElementAccessExpression(node) &&
    isProcessEnvObject(node.expression) &&
    ts.isStringLiteral(node.argumentExpression) &&
    node.argumentExpression.text === identifier
  );
}

/** Returns the static text of an object-literal property name when available. */
function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }

  return null;
}

/** Parses managed scaffold TypeScript and rejects parser-recovered source. */
function parseManagedSource(contents: string): ts.SourceFile {
  const transpiled = ts.transpileModule(contents, {
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.Latest,
    },
    fileName: "managed-integration-contract.tsx",
    reportDiagnostics: true,
  });
  const parseDiagnostics =
    transpiled.diagnostics?.filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    ) ?? [];
  expect(
    parseDiagnostics,
    "managed scaffold source must parse without diagnostics",
  ).toHaveLength(0);

  const sourceFile = ts.createSourceFile(
    "managed-integration-contract.tsx",
    contents,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  return sourceFile;
}

/** Returns an expression without transparent TypeScript wrappers. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }

  return expression;
}

/** Returns one exact object-literal property assignment when present. */
function objectPropertyAssignment(
  objectLiteral: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | null {
  for (const property of objectLiteral.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      propertyNameText(property.name) === name
    ) {
      return property;
    }
  }

  return null;
}

/** Returns whether one expression contains the exact managed env read. */
function expressionContainsEnvRead(
  expression: ts.Expression,
  identifier: string,
): boolean {
  let found = false;

  /** Visits one initializer node looking for the required env read. */
  function visit(node: ts.Node): void {
    if (found) {
      return;
    }
    if (isProcessEnvRead(node, identifier)) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(expression);
  return found;
}

/** Returns whether an expression uses the managed key without telemetry. */
function expressionUsesManagedKeyWithoutTelemetry(
  expression: ts.Expression,
): boolean {
  return (
    expressionContainsEnvRead(expression, MANAGED_API_KEY) &&
    !expressionContainsEnvRead(expression, OPTIONAL_TELEMETRY_ID)
  );
}

/** Returns whether an expression is a literal boolean string projection. */
function isBooleanStringProjection(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (ts.isStringLiteral(unwrapped)) {
    return unwrapped.text === "true" || unwrapped.text === "false";
  }
  if (ts.isConditionalExpression(unwrapped)) {
    return (
      isBooleanStringProjection(unwrapped.whenTrue) &&
      isBooleanStringProjection(unwrapped.whenFalse)
    );
  }
  if (
    ts.isCallExpression(unwrapped) &&
    ts.isPropertyAccessExpression(unwrapped.expression) &&
    ts.isIdentifier(unwrapped.expression.expression) &&
    unwrapped.expression.expression.text === "JSON" &&
    unwrapped.expression.name.text === "stringify" &&
    unwrapped.arguments.length === 1
  ) {
    return isBooleanStringProjection(unwrapped.arguments[0]!);
  }

  return false;
}

/** Returns whether the public gate is boolean-only and keyed by the CPK credential. */
function expressionUsesManagedBooleanGate(expression: ts.Expression): boolean {
  return (
    expressionContainsEnvRead(expression, MANAGED_API_KEY) &&
    !expressionContainsEnvRead(expression, OPTIONAL_TELEMETRY_ID) &&
    isBooleanStringProjection(expression)
  );
}

/** Returns whether a CopilotKit Intelligence constructor owns the API-key read. */
function hasRuntimeApiKeyRead(sourceFile: ts.SourceFile): boolean {
  let found = false;

  /** Visits constructors until the managed Intelligence API-key option is found. */
  function visit(node: ts.Node): void {
    if (found) {
      return;
    }

    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "CopilotKitIntelligence"
    ) {
      const options = node.arguments?.[0];
      const unwrappedOptions = options ? unwrapExpression(options) : null;
      if (unwrappedOptions && ts.isObjectLiteralExpression(unwrappedOptions)) {
        const apiKey = objectPropertyAssignment(unwrappedOptions, "apiKey");
        if (
          apiKey &&
          expressionUsesManagedKeyWithoutTelemetry(apiKey.initializer)
        ) {
          found = true;
          return;
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/** Returns the initializer for one top-level variable identifier. */
function topLevelVariableInitializer(
  sourceFile: ts.SourceFile,
  identifier: string,
): ts.Expression | null {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === identifier
      ) {
        return declaration.initializer ?? null;
      }
    }
  }

  return null;
}

/** Resolves a default-exported object literal through top-level variables. */
function exportedObjectLiteral(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  seenIdentifiers: ReadonlySet<string> = new Set(),
): ts.ObjectLiteralExpression | null {
  const unwrapped = unwrapExpression(expression);
  if (ts.isObjectLiteralExpression(unwrapped)) {
    return unwrapped;
  }
  if (ts.isIdentifier(unwrapped) && !seenIdentifiers.has(unwrapped.text)) {
    const initializer = topLevelVariableInitializer(sourceFile, unwrapped.text);
    if (initializer) {
      return exportedObjectLiteral(
        initializer,
        sourceFile,
        new Set([...seenIdentifiers, unwrapped.text]),
      );
    }
  }

  return null;
}

/** Returns the source's default export expression when it has one. */
function defaultExportExpression(
  sourceFile: ts.SourceFile,
): ts.Expression | null {
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      return statement.expression;
    }
  }

  return null;
}

/** Returns whether the exported Next or Vite thread gate owns the key read. */
function hasExportedGateApiKeyRead(sourceFile: ts.SourceFile): boolean {
  const exported = defaultExportExpression(sourceFile);
  if (!exported) {
    return false;
  }

  const nextConfig = exportedObjectLiteral(exported, sourceFile);
  if (
    nextConfig &&
    nestedPropertyMatches(
      nextConfig,
      "env",
      NEXT_THREADS_GATE,
      expressionUsesManagedBooleanGate,
    )
  ) {
    return true;
  }

  const unwrapped = unwrapExpression(exported);
  if (
    ts.isCallExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression) &&
    unwrapped.expression.text === "defineConfig"
  ) {
    const config = unwrapped.arguments[0];
    const unwrappedConfig = config ? unwrapExpression(config) : null;
    if (unwrappedConfig && ts.isObjectLiteralExpression(unwrappedConfig)) {
      return nestedPropertyMatches(
        unwrappedConfig,
        "define",
        `import.meta.env.${VITE_THREADS_GATE}`,
        expressionUsesManagedBooleanGate,
      );
    }
  }

  return false;
}

/** Returns whether a nested object property satisfies an expression predicate. */
function nestedPropertyMatches(
  objectLiteral: ts.ObjectLiteralExpression,
  containerName: string,
  propertyName: string,
  predicate: (expression: ts.Expression) => boolean,
): boolean {
  const container = objectPropertyAssignment(objectLiteral, containerName);
  if (!container) {
    return false;
  }
  const containerInitializer = unwrapExpression(container.initializer);
  if (!ts.isObjectLiteralExpression(containerInitializer)) {
    return false;
  }
  const property = objectPropertyAssignment(containerInitializer, propertyName);
  return Boolean(property && predicate(property.initializer));
}

/** Returns the exact dotted parts of a property-access expression. */
function propertyAccessParts(expression: ts.Expression): readonly string[] {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    return [unwrapped.text];
  }
  if (ts.isPropertyAccessExpression(unwrapped)) {
    return [...propertyAccessParts(unwrapped.expression), unwrapped.name.text];
  }

  return [];
}

/** Returns whether an expression contains an exact dotted property path. */
function expressionContainsPropertyPath(
  expression: ts.Expression,
  expectedPath: readonly string[],
): boolean {
  let found = false;

  /** Visits one expression node for the exact configured path. */
  function visit(node: ts.Node): void {
    if (found) return;
    if (
      ts.isExpression(node) &&
      propertyAccessParts(node).join(".") === expectedPath.join(".")
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(expression);
  return found;
}

/** Returns whether an expression resolves a value through Secrets Manager. */
function expressionContainsSecretResolution(
  expression: ts.Expression,
): boolean {
  let found = false;

  /** Visits one expression node for an explicit Secrets Manager call. */
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = propertyAccessParts(node.expression);
      if (
        callee.at(-1) === "secretsManager" &&
        callee.includes("SecretValue")
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(expression);
  return found;
}

/** Returns all new-expression option objects matching a construct name and id. */
function constructOptions(
  sourceFile: ts.SourceFile,
  constructorPath: readonly string[],
  constructId: string,
): readonly ts.ObjectLiteralExpression[] {
  const matches: ts.ObjectLiteralExpression[] = [];

  /** Visits construct calls for exact constructor and id ownership. */
  function visit(node: ts.Node): void {
    if (
      ts.isNewExpression(node) &&
      propertyAccessParts(node.expression).join(".") ===
        constructorPath.join(".") &&
      node.arguments?.[1] &&
      ts.isStringLiteral(node.arguments[1]) &&
      node.arguments[1].text === constructId
    ) {
      const options = node.arguments[2]
        ? unwrapExpression(node.arguments[2])
        : null;
      if (options && ts.isObjectLiteralExpression(options)) {
        matches.push(options);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return matches;
}

/**
 * Matches a documented environment assignment, including commented examples.
 *
 * @param identifier - Exact environment identifier expected before `=`.
 * @returns A multiline assignment pattern.
 */
function envAssignmentPattern(identifier: string): RegExp {
  return new RegExp(`^\\s*#?\\s*${identifier}\\s*=`, "m");
}

/** Returns every blank-line-delimited block in block-oriented text. */
function textBlocks(contents: string): readonly string[] {
  return contents.split(/\r?\n\s*\r?\n/);
}

/** Returns the first blank-line-delimited text block containing a marker. */
function textBlockContaining(contents: string, marker: string): string {
  return textBlocks(contents).find((block) => block.includes(marker)) ?? "";
}

/** Asserts telemetry copy describes identity without prerequisite semantics. */
function expectTelemetryIdentityDocumentation(contents: string): void {
  const telemetryBlock = textBlockContaining(contents, OPTIONAL_TELEMETRY_ID);

  expect(telemetryBlock).toMatch(/\boptional\b/i);
  expect(telemetryBlock).toMatch(/\bnon[- ]?secret\b/i);
  expect(telemetryBlock).toMatch(/\banalytics\b/i);
  expect(telemetryBlock).toMatch(/\bidentity\b/i);
  expect(telemetryBlock).not.toMatch(
    /\b(?:auth(?:entication|orization)?|entitlements?|enabl(?:e[sd]?|ing|ement)|consent(?:s|ed|ing)?|send(?:s|ing)?|sent|transmit(?:s|ted|ting)?)\b/i,
  );
}

/** Returns whether an env block has an explicit comment label. */
function envBlockHasLabel(block: string, label: RegExp): boolean {
  return block
    .split(/\r?\n/)
    .some((line) => /^\s*#/.test(line) && label.test(line));
}

interface ManagedEnvSections {
  readonly apiKey: string;
  readonly telemetry: string;
}

/** Returns the exact ordered managed dotenv sections from the public contract. */
function managedEnvSections(contents: string): ManagedEnvSections | null {
  const lines = contents.replaceAll("\r\n", "\n").split("\n");
  const apiHeader = "# Your CopilotKit Enterprise Intelligence API Key";
  const telemetryHeader = "# CopilotKit Telemetry ID";
  if (
    lines.filter((line) => line === apiHeader).length !== 1 ||
    lines.filter((line) => line === telemetryHeader).length !== 1 ||
    lines.filter((line) => envAssignmentPattern(MANAGED_API_KEY).test(line))
      .length !== 1 ||
    lines.filter((line) =>
      envAssignmentPattern(OPTIONAL_TELEMETRY_ID).test(line),
    ).length !== 1
  ) {
    return null;
  }
  const apiHeaderIndex = lines.findIndex((line) => line === apiHeader);
  if (apiHeaderIndex < 0) return null;

  const projectName = lines[apiHeaderIndex + 1] ?? "";
  const apiKeyAssignment = lines[apiHeaderIndex + 2] ?? "";
  const separator = lines[apiHeaderIndex + 3];
  const telemetryHeaderIndex = apiHeaderIndex + 4;
  if (
    !/^# Project Name: \S.*$/u.test(projectName) ||
    !envAssignmentPattern(MANAGED_API_KEY).test(apiKeyAssignment) ||
    separator !== "" ||
    lines[telemetryHeaderIndex] !== telemetryHeader
  ) {
    return null;
  }

  let telemetryEnd = telemetryHeaderIndex + 1;
  while (telemetryEnd < lines.length && lines[telemetryEnd] !== "") {
    telemetryEnd += 1;
  }
  const telemetry = lines.slice(telemetryHeaderIndex, telemetryEnd).join("\n");
  if (!envAssignmentPattern(OPTIONAL_TELEMETRY_ID).test(telemetry)) {
    return null;
  }

  return {
    apiKey: lines.slice(apiHeaderIndex, apiHeaderIndex + 3).join("\n"),
    telemetry,
  };
}

/** Asserts every env license occurrence has a deployment-mode label. */
function expectEnvLicenseOccurrencesClassified(contents: string): void {
  const licenseBlocks = textBlocks(contents).filter(
    (block) =>
      block.includes(MANAGED_LICENSE_TOKEN) ||
      LICENSE_GATING_LANGUAGE.test(block),
  );

  expect(
    licenseBlocks.every((block) =>
      envBlockHasLabel(block, SELF_HOSTED_OR_OFFLINE_LABEL),
    ),
  ).toBe(true);
}

/** Returns Markdown paragraph starts containing license literals or gating copy. */
function markdownLicenseOccurrenceLines(lines: readonly string[]): number[] {
  const occurrences: number[] = [];
  let start = 0;
  while (start < lines.length) {
    while (start < lines.length && lines[start]?.trim() === "") start += 1;
    if (start >= lines.length) break;
    let end = start + 1;
    while (end < lines.length && lines[end]?.trim() !== "") end += 1;
    const block = lines.slice(start, end).join("\n");
    if (
      block.includes(MANAGED_LICENSE_TOKEN) ||
      LICENSE_GATING_LANGUAGE.test(block)
    ) {
      occurrences.push(start);
    }
    start = end + 1;
  }

  return occurrences;
}

/** Returns the managed Markdown heading section containing both fields. */
function managedMarkdownSection(markdown: string): string {
  const lines = markdown.split(/\r?\n/);

  for (let start = 0; start < lines.length; start += 1) {
    const heading = lines[start]?.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!heading || !MANAGED_DOCUMENTATION_LABEL.test(heading[2] ?? "")) {
      continue;
    }

    const headingLevel = heading[1]?.length ?? 0;
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      const subsequent = lines[index]?.match(/^(#{1,6})\s+/);
      if (subsequent && (subsequent[1]?.length ?? 0) <= headingLevel) {
        end = index;
        break;
      }
    }

    const section = lines.slice(start, end).join("\n");
    if (
      exactEnvIdentifierPattern(MANAGED_API_KEY).test(section) &&
      exactEnvIdentifierPattern(OPTIONAL_TELEMETRY_ID).test(section)
    ) {
      return section;
    }
  }

  return "";
}

/** Returns whether a Markdown line has a heading ancestor with the label. */
function markdownLineHasLabeledAncestor(
  lines: readonly string[],
  lineIndex: number,
  label: RegExp,
): boolean {
  let childLevel = 7;
  for (let index = lineIndex; index >= 0; index -= 1) {
    const heading = lines[index]?.match(/^(#{1,6})\s+(.+?)\s*$/);
    const headingLevel = heading?.[1]?.length ?? 0;
    if (heading && headingLevel < childLevel) {
      if (label.test(heading[2] ?? "")) {
        return true;
      }
      childLevel = headingLevel;
    }
  }

  return false;
}

/** Asserts every README license mention has a deployment-mode heading. */
function expectMarkdownLicenseOccurrencesClassified(markdown: string): void {
  const lines = markdown.split(/\r?\n/);
  const licenseLines = markdownLicenseOccurrenceLines(lines);

  expect(
    licenseLines.every((index) =>
      markdownLineHasLabeledAncestor(
        lines,
        index,
        SELF_HOSTED_OR_OFFLINE_LABEL,
      ),
    ),
  ).toBe(true);
}

/**
 * Asserts the managed runtime reads only the managed project credential.
 *
 * @param contents - Runtime route or bridge source.
 */
function expectManagedRuntimeContract(contents: string): void {
  const sourceFile = parseManagedSource(contents);

  expect(hasRuntimeApiKeyRead(sourceFile)).toBe(true);
  expect(contents).not.toMatch(exactEnvIdentifierPattern(LEGACY_API_KEY));
  expect(contents).not.toMatch(exactEnvIdentifierPattern(LEGACY_TELEMETRY_ID));
  expect(contents).not.toContain(MANAGED_LICENSE_TOKEN);
  expect(contents).not.toMatch(/\blicenseToken\s*:/);
}

/**
 * Asserts the browser-safe feature gate follows the managed project credential.
 *
 * @param contents - Next.js or Vite gate configuration source.
 */
function expectManagedGateContract(contents: string): void {
  const sourceFile = parseManagedSource(contents);

  expect(hasExportedGateApiKeyRead(sourceFile)).toBe(true);
  expect(contents).not.toMatch(exactEnvIdentifierPattern(LEGACY_API_KEY));
  expect(contents).not.toMatch(exactEnvIdentifierPattern(LEGACY_TELEMETRY_ID));
  expect(contents).not.toContain(MANAGED_LICENSE_TOKEN);
}

/**
 * Asserts an env example documents the managed key and optional telemetry ID.
 *
 * @param contents - Managed template environment example contents.
 */
function expectManagedEnvContract(contents: string): void {
  const managedSections = managedEnvSections(contents);

  expect(managedSections).not.toBeNull();
  if (!managedSections) return;
  expect(managedSections.apiKey).toMatch(envAssignmentPattern(MANAGED_API_KEY));
  expectTelemetryIdentityDocumentation(managedSections.telemetry);
  expect(contents).not.toMatch(envAssignmentPattern(LEGACY_API_KEY));
  expect(contents).not.toMatch(envAssignmentPattern(LEGACY_TELEMETRY_ID));
  expectEnvLicenseOccurrencesClassified(contents);
}

/**
 * Asserts a README documents the managed key and optional telemetry identity.
 *
 * @param contents - Managed template README contents.
 */
function expectManagedReadmeContract(contents: string): void {
  const managedSection = managedMarkdownSection(contents);

  expect(managedSection).not.toBe("");
  expectTelemetryIdentityDocumentation(managedSection);
  expect(contents).not.toMatch(exactEnvIdentifierPattern(LEGACY_API_KEY));
  expect(contents).not.toMatch(exactEnvIdentifierPattern(LEGACY_TELEMETRY_ID));
  expectMarkdownLicenseOccurrencesClassified(contents);
}

/** Assert AgentCore local services consume the CLI-managed root env safely. */
function expectAgentCoreLocalComposeContract(contents: string): void {
  const bridge = yamlMappingSection(contents, "bridge");
  const frontend = yamlMappingSection(contents, "frontend");

  expect(bridge).toMatch(rootManagedEnvFilePattern());
  expect(frontend).toMatch(rootManagedEnvFilePattern());
  expect(frontend).not.toContain(VITE_THREADS_GATE);
  expect(contents).not.toMatch(exactEnvIdentifierPattern(LEGACY_API_KEY));
  expect(contents).not.toMatch(exactEnvIdentifierPattern(LEGACY_TELEMETRY_ID));
  expect(contents).not.toContain(MANAGED_LICENSE_TOKEN);
}

/** Assert AgentCore deploy configuration carries only a secret reference. */
function expectAgentCoreDeploymentConfigContract(contents: string): void {
  const configuredSecretNames = contents.split(/\r?\n/).flatMap((line) => {
    const match = line.match(
      new RegExp(
        `^${MANAGED_API_KEY_SECRET_CONFIG}\\s*:\\s*([^#\\s][^#]*?)\\s*(?:#.*)?$`,
      ),
    );
    return match?.[1] ? [match[1].trim()] : [];
  });

  expect(configuredSecretNames).toHaveLength(1);
  expect(configuredSecretNames[0]).not.toMatch(/^\$\{|^process\.env\b/);
  expect(contents).not.toMatch(exactEnvIdentifierPattern(MANAGED_API_KEY));
  expect(contents).not.toContain(MANAGED_LICENSE_TOKEN);
}

/** Assert AgentCore's deployed Lambda resolves the managed key from a secret. */
function expectAgentCoreRuntimeDeploymentContract(contents: string): void {
  const sourceFile = parseManagedSource(contents);
  const lambdaOptions = constructOptions(
    sourceFile,
    ["lambda", "Function"],
    "CopilotKitRuntimeLambda",
  );
  expect(lambdaOptions).toHaveLength(1);
  const environment = lambdaOptions[0]
    ? objectPropertyAssignment(lambdaOptions[0], "environment")
    : null;
  const environmentObject = environment
    ? unwrapExpression(environment.initializer)
    : null;
  expect(
    environmentObject && ts.isObjectLiteralExpression(environmentObject),
  ).toBe(true);
  const managedKey =
    environmentObject && ts.isObjectLiteralExpression(environmentObject)
      ? objectPropertyAssignment(environmentObject, MANAGED_API_KEY)
      : null;
  expect(managedKey).not.toBeNull();
  if (!managedKey) return;

  expect(
    expressionContainsPropertyPath(managedKey.initializer, [
      "config",
      MANAGED_API_KEY_SECRET_CONFIG,
    ]),
  ).toBe(true);
  expect(expressionContainsSecretResolution(managedKey.initializer)).toBe(true);
  expect(
    expressionContainsEnvRead(managedKey.initializer, MANAGED_API_KEY),
  ).toBe(false);
  expect(contents).not.toContain(MANAGED_LICENSE_TOKEN);
}

/** Assert AgentCore's frontend receives only the key-derived public gate. */
function expectAgentCoreFrontendDeploymentContract(contents: string): void {
  const sourceFile = parseManagedSource(contents);
  const appOptions = constructOptions(
    sourceFile,
    ["amplify", "App"],
    "AmplifyApp",
  );
  expect(appOptions).toHaveLength(1);
  const environmentVariables = appOptions[0]
    ? objectPropertyAssignment(appOptions[0], "environmentVariables")
    : null;
  const environmentObject = environmentVariables
    ? unwrapExpression(environmentVariables.initializer)
    : null;
  const managedGate =
    environmentObject && ts.isObjectLiteralExpression(environmentObject)
      ? objectPropertyAssignment(environmentObject, VITE_THREADS_GATE)
      : null;
  expect(managedGate).not.toBeNull();
  if (!managedGate) return;

  expect(isBooleanStringProjection(managedGate.initializer)).toBe(true);
  expect(
    expressionContainsPropertyPath(managedGate.initializer, [
      "props",
      "config",
      MANAGED_API_KEY_SECRET_CONFIG,
    ]),
  ).toBe(true);
  expect(
    expressionContainsEnvRead(managedGate.initializer, MANAGED_API_KEY),
  ).toBe(false);
  expect(contents).not.toMatch(exactEnvIdentifierPattern(MANAGED_API_KEY));
  expect(contents).not.toContain(MANAGED_LICENSE_TOKEN);
}

/** Assert an AgentCore variant deploy script safely materializes its key secret. */
function expectAgentCoreDeployScriptContract(contents: string): void {
  const normalized = contents.replace(/\\\r?\n\s*/g, " ");
  const lines = normalized.split(/\r?\n/);
  const rootEnvLoadIndex = lines.findIndex((line) =>
    /(?:^|\s)(?:source|\.)\s+["']?\$\{?SCRIPT_DIR\}?\/\.env["']?(?:\s|$)/.test(
      line,
    ),
  );
  const secretConfigAssignment = lines
    .map((line, index) => ({
      index,
      match: line.match(
        new RegExp(`^\\s*([A-Z][A-Z0-9_]*)=.*${MANAGED_API_KEY_SECRET_CONFIG}`),
      ),
    }))
    .find(({ match }) => match?.[1]);
  const secretNameVariable = secretConfigAssignment?.match?.[1];
  const secretCommands = lines
    .map((line, index) => ({ index, line }))
    .filter(({ line }) =>
      /aws\s+secretsmanager\s+(?:create-secret|put-secret-value)\b/.test(line),
    );
  const cdkDeployIndex = lines.findIndex((line) =>
    /npx\s+cdk(?:@\S+)?\s+deploy\b/.test(line),
  );

  expect(rootEnvLoadIndex).toBeGreaterThanOrEqual(0);
  expect(secretNameVariable).toBeDefined();
  expect(secretCommands.length).toBeGreaterThan(0);
  expect(cdkDeployIndex).toBeGreaterThan(
    Math.max(...secretCommands.map(({ index }) => index)),
  );
  for (const { line } of secretCommands) {
    expect(line).toMatch(
      new RegExp(
        `--secret-string(?:=|\\s+)["']?\\$\\{?${MANAGED_API_KEY}\\}?["']?(?:\\s|$)`,
      ),
    );
    expect(line).toMatch(
      new RegExp(
        `--(?:name|secret-id)(?:=|\\s+)["']?\\$\\{?${secretNameVariable}\\}?["']?(?:\\s|$)`,
      ),
    );
  }
  expect(rootEnvLoadIndex).toBeLessThan(secretCommands[0]!.index);
  expect(secretConfigAssignment!.index).toBeLessThan(secretCommands[0]!.index);
  expect(contents).not.toContain(MANAGED_LICENSE_TOKEN);
}

/** Returns exact path filters for one top-level workflow event. */
function workflowEventPaths(contents: string, eventName: string): string[] {
  const lines = contents.split(/\r?\n/);
  const eventStart = lines.findIndex((line) => line === `  ${eventName}:`);
  if (eventStart < 0) return [];
  const relativeEventEnd = lines
    .slice(eventStart + 1)
    .findIndex((line) => /^(?:\S| {2}\S).*:\s*$/.test(line));
  const eventEnd =
    relativeEventEnd < 0 ? lines.length : eventStart + relativeEventEnd + 1;
  const eventLines = lines.slice(eventStart, eventEnd);
  const pathsStart = eventLines.findIndex((line) => line === "    paths:");
  if (pathsStart < 0) return [];

  const paths: string[] = [];
  for (const line of eventLines.slice(pathsStart + 1)) {
    const match = line.match(/^      - ["']?(.+?)["']?\s*$/);
    if (!match?.[1]) break;
    paths.push(match[1]);
  }
  return paths;
}

interface WorkflowStep {
  readonly name: string;
  readonly run: string;
}

/** Returns named workflow steps with their complete run scripts. */
function workflowSteps(contents: string): WorkflowStep[] {
  const lines = contents.split(/\r?\n/);
  const stepStarts = lines.flatMap((line, index) =>
    /^      - name:\s*/.test(line) ? [index] : [],
  );

  return stepStarts.map((start, position) => {
    const end = stepStarts[position + 1] ?? lines.length;
    const stepLines = lines.slice(start, end);
    const name = stepLines[0]!
      .replace(/^      - name:\s*/, "")
      .replace(/^["']|["']$/g, "");
    const runStart = stepLines.findIndex((line) =>
      line.startsWith("        run:"),
    );
    const run =
      runStart < 0
        ? ""
        : stepLines
            .slice(runStart)
            .join("\n")
            .replace(/^\s*run:\s*[|>-]?\s*/m, "")
            .trim();
    return { name, run };
  });
}

/** Assert the parity workflow preserves filters and runs red contracts second. */
function expectIntegrationParityWorkflowContract(contents: string): void {
  const expectedPaths = [
    "examples/integrations/**",
    "scripts/__tests__/integration-intelligence-migration.test.ts",
    ".github/workflows/integrations_parity.yml",
  ];
  expect(workflowEventPaths(contents, "pull_request")).toEqual(expectedPaths);
  expect(workflowEventPaths(contents, "push")).toEqual(expectedPaths);

  const steps = workflowSteps(contents);
  const parityIndex = steps.findIndex(
    ({ name }) => name === "Verify integration-demo parity",
  );
  const contractIndex = steps.findIndex(
    ({ name }) => name === "Verify managed integration credential contracts",
  );
  expect(parityIndex).toBeGreaterThanOrEqual(0);
  expect(contractIndex).toBeGreaterThan(parityIndex);
  expect(steps[parityIndex]?.run).toContain("pnpm parity:check");
  expect(steps[contractIndex]?.run).toContain(
    "pnpm exec vitest run scripts/__tests__/integration-intelligence-migration.test.ts",
  );
}

/** Renders an exact workflow path-filter list for helper self-tests. */
function renderWorkflowPaths(values: readonly string[]): string {
  return values.map((value) => `      - "${value}"`).join("\n");
}

test("managed TypeScript helpers reject API-key identifiers outside configured expressions", () => {
  const unusedRuntimeRead = `
    const unused = process.env.CPK_INTELLIGENCE_API_KEY;
    // apiKey: process.env.CPK_INTELLIGENCE_API_KEY
    const intelligence = { apiKey: "CPK_INTELLIGENCE_API_KEY" };
  `;
  const unusedGateRead = `
    const unused = process.env["CPK_INTELLIGENCE_API_KEY"];
    // NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED: process.env.CPK_INTELLIGENCE_API_KEY
    export default {
      env: { NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED: "false" },
    };
  `;

  expect(() => expectManagedRuntimeContract(unusedRuntimeRead)).toThrow();
  expect(() => expectManagedGateContract(unusedGateRead)).toThrow();
});

test("managed TypeScript helpers reject decoy configured properties", () => {
  const decoyRuntimeRead = `
    const decoy = { apiKey: process.env.CPK_INTELLIGENCE_API_KEY };
    const intelligence = new CopilotKitIntelligence({ apiKey: "" });
  `;
  const decoyNextGateRead = `
    const decoy = {
      NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED:
        process.env.CPK_INTELLIGENCE_API_KEY ? "true" : "false",
    };
    const nextConfig = {
      env: { NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED: "false" },
    };
    export default nextConfig;
  `;
  const decoyViteGateRead = `
    const decoy = {
      "import.meta.env.VITE_COPILOTKIT_THREADS_ENABLED":
        process.env.CPK_INTELLIGENCE_API_KEY ? "true" : "false",
    };
    export default defineConfig({
      define: {
        "import.meta.env.VITE_COPILOTKIT_THREADS_ENABLED": "false",
      },
    });
  `;

  expect(() => expectManagedRuntimeContract(decoyRuntimeRead)).toThrow();
  expect(() => expectManagedGateContract(decoyNextGateRead)).toThrow();
  expect(() => expectManagedGateContract(decoyViteGateRead)).toThrow();
});

test("managed gate helpers reject direct, concatenated, comment-only, and decoy key exposure", () => {
  const invalidGateSources = [
    `export default { env: { ${NEXT_THREADS_GATE}: process.env.${MANAGED_API_KEY} } };`,
    `export default { env: { ${NEXT_THREADS_GATE}: "enabled-" + process.env.${MANAGED_API_KEY} } };`,
    `
      // ${NEXT_THREADS_GATE}: process.env.${MANAGED_API_KEY} ? "true" : "false"
      export default { env: { ${NEXT_THREADS_GATE}: "false" } };
    `,
    `
      const decoy = process.env.${MANAGED_API_KEY} ? "true" : "false";
      export default { env: { ${NEXT_THREADS_GATE}: "false" } };
    `,
  ];

  for (const source of invalidGateSources) {
    expect(() => expectManagedGateContract(source)).toThrow();
  }
});

test("managed gate helpers accept normalized Next and Vite boolean projections", () => {
  const nextGate = `
    export default {
      env: {
        ${NEXT_THREADS_GATE}: process.env.${MANAGED_API_KEY}
          ? "true"
          : "false",
      },
    };
  `;
  const viteGateWithOverride = `
    export default defineConfig({
      define: {
        "import.meta.env.${VITE_THREADS_GATE}": JSON.stringify(
          process.env.${VITE_THREADS_GATE} === "true"
            ? "true"
            : process.env.${MANAGED_API_KEY}
              ? "true"
              : "false",
        ),
      },
    });
  `;

  expect(() => expectManagedGateContract(nextGate)).not.toThrow();
  expect(() => expectManagedGateContract(viteGateWithOverride)).not.toThrow();
});

test("AgentCore structural helpers accept linked root-env, secret, Lambda, and frontend wiring", () => {
  const deploymentConfig = `${MANAGED_API_KEY_SECRET_CONFIG}: cpk-managed-key`;
  const runtimeDeployment = `
    new lambda.Function(this, "CopilotKitRuntimeLambda", {
      environment: {
        ${MANAGED_API_KEY}: cdk.SecretValue.secretsManager(
          config.${MANAGED_API_KEY_SECRET_CONFIG},
        ).unsafeUnwrap(),
      },
    });
  `;
  const frontendDeployment = `
    new amplify.App(this, "AmplifyApp", {
      environmentVariables: {
        ${VITE_THREADS_GATE}: props.config.${MANAGED_API_KEY_SECRET_CONFIG}
          ? "true"
          : "false",
      },
    });
  `;
  const deployScript = `
    source "$SCRIPT_DIR/.env"
    CPK_SECRET_NAME=$(read_config ${MANAGED_API_KEY_SECRET_CONFIG})
    aws secretsmanager create-secret --name "$CPK_SECRET_NAME" --secret-string "$${MANAGED_API_KEY}"
    npx cdk deploy --all
  `;

  expect(() =>
    expectAgentCoreDeploymentConfigContract(deploymentConfig),
  ).not.toThrow();
  expect(() =>
    expectAgentCoreRuntimeDeploymentContract(runtimeDeployment),
  ).not.toThrow();
  expect(() =>
    expectAgentCoreFrontendDeploymentContract(frontendDeployment),
  ).not.toThrow();
  expect(() => expectAgentCoreDeployScriptContract(deployScript)).not.toThrow();
});

test("AgentCore structural helpers reject comment, unrelated-secret, and disconnected-command decoys", () => {
  const runtimeDecoy = `
    // ${MANAGED_API_KEY} uses config.${MANAGED_API_KEY_SECRET_CONFIG}
    const unrelated = cdk.SecretValue.secretsManager("other-secret");
    new lambda.Function(this, "CopilotKitRuntimeLambda", {
      environment: { ${MANAGED_API_KEY}: "literal-key" },
    });
  `;
  const frontendDecoy = `
    // ${VITE_THREADS_GATE} follows props.config.${MANAGED_API_KEY_SECRET_CONFIG}
    new amplify.App(this, "AmplifyApp", {
      environmentVariables: { ${VITE_THREADS_GATE}: "enabled" },
    });
  `;
  const deployScriptDecoy = `
    # source "$SCRIPT_DIR/.env"
    CPK_SECRET_NAME=$(read_config ${MANAGED_API_KEY_SECRET_CONFIG})
    echo "$${MANAGED_API_KEY}"
    aws secretsmanager create-secret --name unrelated --secret-string literal
    npx cdk deploy --all
  `;

  expect(() =>
    expectAgentCoreRuntimeDeploymentContract(runtimeDecoy),
  ).toThrow();
  expect(() =>
    expectAgentCoreFrontendDeploymentContract(frontendDecoy),
  ).toThrow();
  expect(() =>
    expectAgentCoreDeployScriptContract(deployScriptDecoy),
  ).toThrow();
  expect(() =>
    expectAgentCoreDeploymentConfigContract(
      `${MANAGED_API_KEY_SECRET_CONFIG}: \${${MANAGED_API_KEY}}`,
    ),
  ).toThrow();
});

test("managed TypeScript helpers reject malformed source", () => {
  const malformedRuntime = `
    const intelligence = new CopilotKitIntelligence({
      apiKey: process.env.CPK_INTELLIGENCE_API_KEY,
    });
  }`;
  const malformedGate = `
    export default {
      env: {
        NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED:
          process.env.CPK_INTELLIGENCE_API_KEY ? "true" : "false",
      },
    `;

  expect(() => expectManagedRuntimeContract(malformedRuntime)).toThrow();
  expect(() => expectManagedGateContract(malformedGate)).toThrow();
});

test("managed TypeScript helpers accept independent telemetry reads", () => {
  const configuredRuntimeRead = `
    const telemetryId = process.env.CPK_TELEMETRY_ID;
    const intelligence = new CopilotKitIntelligence({
      apiKey: process.env["CPK_INTELLIGENCE_API_KEY"] ?? "",
    });
  `;
  const configuredGateRead = `
    const telemetryId = process.env["CPK_TELEMETRY_ID"];
    const nextConfig = {
      env: {
        NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED:
          process.env.CPK_INTELLIGENCE_API_KEY ? "true" : "false",
      },
    };
    export default nextConfig;
  `;
  const configuredViteGateRead = `
    const telemetryId = process.env.CPK_TELEMETRY_ID;
    export default defineConfig({
      define: {
        "import.meta.env.VITE_COPILOTKIT_THREADS_ENABLED": JSON.stringify(
          process.env["CPK_INTELLIGENCE_API_KEY"] ? "true" : "false",
        ),
      },
    });
  `;

  expect(() =>
    expectManagedRuntimeContract(configuredRuntimeRead),
  ).not.toThrow();
  expect(() => expectManagedGateContract(configuredGateRead)).not.toThrow();
  expect(() => expectManagedGateContract(configuredViteGateRead)).not.toThrow();
});

test("managed TypeScript helpers reject telemetry prerequisites", () => {
  const telemetryGatedRuntime = `
    const intelligence = new CopilotKitIntelligence({
      apiKey:
        process.env.CPK_INTELLIGENCE_API_KEY &&
        process.env.CPK_TELEMETRY_ID,
    });
  `;
  const telemetryGatedNextConfig = `
    const nextConfig = {
      env: {
        NEXT_PUBLIC_COPILOTKIT_THREADS_ENABLED:
          process.env.CPK_INTELLIGENCE_API_KEY &&
          process.env.CPK_TELEMETRY_ID
            ? "true"
            : "false",
      },
    };
    export default nextConfig;
  `;
  const telemetryGatedViteConfig = `
    export default defineConfig({
      define: {
        "import.meta.env.VITE_COPILOTKIT_THREADS_ENABLED": JSON.stringify(
          process.env.CPK_INTELLIGENCE_API_KEY &&
            process.env.CPK_TELEMETRY_ID
            ? "true"
            : "false",
        ),
      },
    });
  `;

  expect(() => expectManagedRuntimeContract(telemetryGatedRuntime)).toThrow();
  expect(() => expectManagedGateContract(telemetryGatedNextConfig)).toThrow();
  expect(() => expectManagedGateContract(telemetryGatedViteConfig)).toThrow();
});

/** Build the exact managed dotenv sections with telemetry semantics documented. */
function managedEnvExample(
  telemetryDescription = "Optional, non-secret analytics identity.",
): string {
  return [
    "# Your CopilotKit Enterprise Intelligence API Key",
    "# Project Name: xxxxxxxxxx",
    "CPK_INTELLIGENCE_API_KEY=xxxxx",
    "",
    "# CopilotKit Telemetry ID",
    `# ${telemetryDescription}`,
    "CPK_TELEMETRY_ID=xxxxx",
  ].join("\n");
}

test("managed documentation helpers reject misleading telemetry semantics", () => {
  const misleadingDescriptions = [
    "authentication credential",
    "entitlement identity",
    "feature enablement identity",
    "analytics consent identity",
    "telemetry send-policy identity",
  ];

  for (const description of misleadingDescriptions) {
    const envExample = managedEnvExample(
      `Optional, non-secret analytics ${description}.`,
    );
    const readme = [
      "## Managed Intelligence credentials",
      "",
      "Set `CPK_INTELLIGENCE_API_KEY` for the project.",
      "",
      `\`CPK_TELEMETRY_ID\` is an optional, non-secret analytics ${description}.`,
    ].join("\n");

    expect(() => expectManagedEnvContract(envExample)).toThrow();
    expect(() => expectManagedReadmeContract(readme)).toThrow();
  }
});

test("managed documentation helpers accept an optional non-secret analytics identity", () => {
  const envExample = managedEnvExample();
  const readme = [
    "## Managed Intelligence credentials",
    "",
    "Set `CPK_INTELLIGENCE_API_KEY` for the project.",
    "",
    "`CPK_TELEMETRY_ID` is an optional, non-secret analytics identity.",
  ].join("\n");

  expect(() => expectManagedEnvContract(envExample)).not.toThrow();
  expect(() => expectManagedReadmeContract(readme)).not.toThrow();
});

test.each([
  {
    invalidLayout: "two blank lines between sections",
    envExample: managedEnvExample().replace(
      "CPK_INTELLIGENCE_API_KEY=xxxxx\n\n# CopilotKit",
      "CPK_INTELLIGENCE_API_KEY=xxxxx\n\n\n# CopilotKit",
    ),
  },
  {
    invalidLayout: "duplicate telemetry section",
    envExample: `${managedEnvExample()}\n\n# CopilotKit Telemetry ID\nCPK_TELEMETRY_ID=duplicate`,
  },
])("managed documentation helpers reject $invalidLayout", ({ envExample }) => {
  expect(() => expectManagedEnvContract(envExample)).toThrow();
});

test("managed documentation helpers reject license guidance inside the telemetry section", () => {
  const envExample = `${managedEnvExample()}\nCOPILOTKIT_LICENSE_TOKEN=`;
  const readme = [
    "## Managed Intelligence credentials",
    "",
    "Set CPK_INTELLIGENCE_API_KEY for the project.",
    "CPK_TELEMETRY_ID is an optional, non-secret analytics identity.",
    "COPILOTKIT_LICENSE_TOKEN is not a managed credential.",
  ].join("\n");

  expect(() => expectManagedEnvContract(envExample)).toThrow();
  expect(() => expectManagedReadmeContract(readme)).toThrow();
});

test("managed documentation helpers reject separated unlabeled license guidance", () => {
  const envExample = [
    managedEnvExample(),
    "",
    "# Self-hosted / offline license",
    "COPILOTKIT_LICENSE_TOKEN=",
    "",
    "# Troubleshooting",
    "COPILOTKIT_LICENSE_TOKEN=",
  ].join("\n");
  const readme = [
    "## Managed Intelligence credentials",
    "",
    "Set CPK_INTELLIGENCE_API_KEY for the project.",
    "CPK_TELEMETRY_ID is an optional, non-secret analytics identity.",
    "",
    "## Self-hosted / offline license",
    "",
    "Offline deployments may set COPILOTKIT_LICENSE_TOKEN.",
    "",
    "## Troubleshooting",
    "",
    "Set COPILOTKIT_LICENSE_TOKEN if the managed integration is unavailable.",
  ].join("\n");

  expect(() => expectManagedEnvContract(envExample)).toThrow();
  expect(() => expectManagedReadmeContract(readme)).toThrow();
});

test("managed documentation helpers reject reordered managed dotenv sections", () => {
  const envExample = [
    "# CopilotKit Telemetry ID",
    "# Optional, non-secret analytics identity.",
    "CPK_TELEMETRY_ID=xxxxx",
    "",
    "# Your CopilotKit Enterprise Intelligence API Key",
    "# Project Name: xxxxxxxxxx",
    "CPK_INTELLIGENCE_API_KEY=xxxxx",
  ].join("\n");
  const readme = [
    "## Managed Intelligence credentials",
    "",
    "Set CPK_INTELLIGENCE_API_KEY for the project.",
    "",
    "## Analytics identity",
    "",
    "CPK_TELEMETRY_ID is an optional, non-secret analytics identity.",
  ].join("\n");

  expect(() => expectManagedEnvContract(envExample)).toThrow();
  expect(() => expectManagedReadmeContract(readme)).toThrow();
});

test("managed documentation helpers allow separate self-hosted and offline license guidance", () => {
  const envExample = [
    managedEnvExample(),
    "",
    "# Self-hosted / offline license",
    "COPILOTKIT_LICENSE_TOKEN=",
  ].join("\n");
  const readme = [
    "## Managed Intelligence credentials",
    "",
    "Set CPK_INTELLIGENCE_API_KEY for the project.",
    "CPK_TELEMETRY_ID is an optional, non-secret analytics identity.",
    "",
    "### Self-hosted / offline license",
    "",
    "Offline deployments may set COPILOTKIT_LICENSE_TOKEN instead.",
  ].join("\n");

  expect(() => expectManagedEnvContract(envExample)).not.toThrow();
  expect(() => expectManagedReadmeContract(readme)).not.toThrow();
});

test("managed documentation helpers reject unlabeled generic license-gating copy without an env literal", () => {
  const envExample = [
    managedEnvExample(),
    "",
    "# Product capabilities",
    "# A license unlocks Threads and enables Inspector.",
  ].join("\n");
  const readme = [
    "## Managed Intelligence credentials",
    "",
    "Set CPK_INTELLIGENCE_API_KEY for the project.",
    "CPK_TELEMETRY_ID is an optional, non-secret analytics identity.",
    "",
    "## Product capabilities",
    "",
    "A license activates Threads and unlocks Inspector.",
  ].join("\n");

  expect(() => expectManagedEnvContract(envExample)).toThrow();
  expect(() => expectManagedReadmeContract(readme)).toThrow();
});

test("managed documentation helpers allow generic license-gating copy only in self-hosted or offline sections", () => {
  const envExample = [
    managedEnvExample(),
    "",
    "# Self-hosted / offline license behavior",
    "# A deployment license enables Threads and Inspector offline.",
  ].join("\n");
  const readme = [
    "## Managed Intelligence credentials",
    "",
    "Set CPK_INTELLIGENCE_API_KEY for the project.",
    "CPK_TELEMETRY_ID is an optional, non-secret analytics identity.",
    "",
    "## Self-hosted / offline license behavior",
    "",
    "A deployment license enables Threads and Inspector offline.",
  ].join("\n");

  expect(() => expectManagedEnvContract(envExample)).not.toThrow();
  expect(() => expectManagedReadmeContract(readme)).not.toThrow();
});

test("integration parity workflow preserves filters and runs parity before the expected-red managed contract", () => {
  const workflow = fs.readFileSync(INTEGRATION_PARITY_WORKFLOW, "utf8");

  expectIntegrationParityWorkflowContract(workflow);
});

test("integration parity workflow helper rejects missing filters and reversed contract order", () => {
  const paths = [
    "examples/integrations/**",
    "scripts/__tests__/integration-intelligence-migration.test.ts",
    ".github/workflows/integrations_parity.yml",
  ];
  const workflow = (eventPaths: readonly string[], reversed: boolean) => `
on:
  pull_request:
    paths:
${renderWorkflowPaths(eventPaths)}
  push:
    paths:
${renderWorkflowPaths(paths)}
jobs:
  parity-check:
    steps:
      - name: ${reversed ? "Verify managed integration credential contracts" : "Verify integration-demo parity"}
        run: ${reversed ? "pnpm exec vitest run scripts/__tests__/integration-intelligence-migration.test.ts" : "pnpm parity:check"}
      - name: ${reversed ? "Verify integration-demo parity" : "Verify managed integration credential contracts"}
        run: ${reversed ? "pnpm parity:check" : "pnpm exec vitest run scripts/__tests__/integration-intelligence-migration.test.ts"}
`;

  expect(() =>
    expectIntegrationParityWorkflowContract(workflow(paths, true)),
  ).toThrow();
  expect(() =>
    expectIntegrationParityWorkflowContract(workflow(paths.slice(0, 2), false)),
  ).toThrow();
});

test("the 16 managed template directories back all 19 in-repo CLI frameworks", () => {
  const frameworks = MANAGED_TEMPLATE_CONTRACTS.flatMap(
    (contract) => contract.frameworks,
  );

  expect(MANAGED_TEMPLATE_CONTRACTS).toHaveLength(16);
  expect(new Set(frameworks).size).toBe(19);
  expect([...frameworks].sort()).toEqual([...MANAGED_CLI_FRAMEWORKS].sort());
});

for (const contract of MANAGED_TEMPLATE_CONTRACTS) {
  test(`${contract.directory} runtime uses the managed Intelligence API key`, () => {
    const runtime = readManagedSurface(
      contract,
      contract.runtimePath,
      "runtime",
    );

    expectManagedRuntimeContract(runtime);
  });

  test(`${contract.directory} client gate uses the managed Intelligence API key`, () => {
    const gate = readManagedSurface(contract, contract.gatePath, "client gate");

    expectManagedGateContract(gate);
  });

  test(`${contract.directory} env example documents managed Intelligence credentials`, () => {
    const envExample = readManagedSurface(
      contract,
      contract.envPath,
      "env example",
    );

    expectManagedEnvContract(envExample);
  });

  test(`${contract.directory} README documents managed Intelligence credentials`, () => {
    const readme = readManagedSurface(contract, contract.readmePath, "README");

    expectManagedReadmeContract(readme);
  });

  if ("supportedPaths" in contract) {
    const supportedPaths = contract.supportedPaths;
    test(`${contract.directory} local Compose consumes the root managed env`, () => {
      const compose = readManagedSurface(
        contract,
        supportedPaths.localComposePath,
        "local Compose config",
      );

      expectAgentCoreLocalComposeContract(compose);
    });

    test(`${contract.directory} deployment config stores a managed key secret reference`, () => {
      const deploymentConfig = readManagedSurface(
        contract,
        supportedPaths.deploymentConfigPath,
        "deployment config",
      );

      expectAgentCoreDeploymentConfigContract(deploymentConfig);
    });

    test(`${contract.directory} deployed Lambda resolves the managed key secret`, () => {
      const runtimeDeployment = readManagedSurface(
        contract,
        supportedPaths.runtimeDeploymentPath,
        "runtime deployment config",
      );

      expectAgentCoreRuntimeDeploymentContract(runtimeDeployment);
    });

    test(`${contract.directory} deployed frontend receives only the key-derived gate`, () => {
      const frontendDeployment = readManagedSurface(
        contract,
        supportedPaths.frontendDeploymentPath,
        "frontend deployment config",
      );

      expectAgentCoreFrontendDeploymentContract(frontendDeployment);
    });

    test(`${contract.directory} deploy scripts materialize the configured managed key secret`, () => {
      for (const deployScriptPath of supportedPaths.deployScriptPaths) {
        const deployScript = readManagedSurface(
          contract,
          deployScriptPath,
          "deploy script",
        );
        expectAgentCoreDeployScriptContract(deployScript);
      }
    });
  }
}
