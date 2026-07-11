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

/** Matches a deployment config key without constraining its safe reference. */
function deploymentConfigReferencePattern(identifier: string): RegExp {
  return new RegExp(`^\\s*${identifier}\\s*:`, "m");
}

/** Matches two required terms close enough to belong to one configuration. */
function nearbyTermsPattern(first: string, second: string): RegExp {
  return new RegExp(
    `(?:${first}[\\s\\S]{0,400}${second}|${second}[\\s\\S]{0,400}${first})`,
  );
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

/** Returns whether a nested object property owns the managed env read. */
function nestedPropertyContainsEnvRead(
  objectLiteral: ts.ObjectLiteralExpression,
  containerName: string,
  propertyName: string,
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
  return Boolean(
    property && expressionUsesManagedKeyWithoutTelemetry(property.initializer),
  );
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
    nestedPropertyContainsEnvRead(nextConfig, "env", NEXT_THREADS_GATE)
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
      return nestedPropertyContainsEnvRead(
        unwrappedConfig,
        "define",
        `import.meta.env.${VITE_THREADS_GATE}`,
      );
    }
  }

  return false;
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

/** Returns the explicitly labeled managed env block containing both fields. */
function managedEnvBlock(contents: string): string {
  return (
    textBlocks(contents).find(
      (block) =>
        envBlockHasLabel(block, MANAGED_DOCUMENTATION_LABEL) &&
        envAssignmentPattern(MANAGED_API_KEY).test(block) &&
        envAssignmentPattern(OPTIONAL_TELEMETRY_ID).test(block),
    ) ?? ""
  );
}

/** Asserts every env license occurrence has a deployment-mode label. */
function expectEnvLicenseOccurrencesClassified(contents: string): void {
  const licenseBlocks = textBlocks(contents).filter((block) =>
    block.includes(MANAGED_LICENSE_TOKEN),
  );

  expect(
    licenseBlocks.every((block) =>
      envBlockHasLabel(block, SELF_HOSTED_OR_OFFLINE_LABEL),
    ),
  ).toBe(true);
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
  const licenseLines = lines.flatMap((line, index) =>
    line.includes(MANAGED_LICENSE_TOKEN) ? [index] : [],
  );

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
  const managedBlock = managedEnvBlock(contents);

  expect(managedBlock).not.toBe("");
  expectTelemetryIdentityDocumentation(managedBlock);
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
  expect(contents).toMatch(
    deploymentConfigReferencePattern(MANAGED_API_KEY_SECRET_CONFIG),
  );
  expect(contents).not.toMatch(exactEnvIdentifierPattern(MANAGED_API_KEY));
  expect(contents).not.toContain(MANAGED_LICENSE_TOKEN);
}

/** Assert AgentCore's deployed Lambda resolves the managed key from a secret. */
function expectAgentCoreRuntimeDeploymentContract(contents: string): void {
  expect(contents).toMatch(
    nearbyTermsPattern(MANAGED_API_KEY, MANAGED_API_KEY_SECRET_CONFIG),
  );
  expect(contents).toMatch(/\b(?:SecretValue|secretsmanager|secretName)\b/i);
  expect(contents).not.toMatch(
    new RegExp(`${MANAGED_API_KEY}\\s*:\\s*["'\\x60]`),
  );
  expect(contents).not.toContain(MANAGED_LICENSE_TOKEN);
}

/** Assert AgentCore's frontend receives only the key-derived public gate. */
function expectAgentCoreFrontendDeploymentContract(contents: string): void {
  expect(contents).toMatch(
    nearbyTermsPattern(VITE_THREADS_GATE, MANAGED_API_KEY_SECRET_CONFIG),
  );
  expect(contents).not.toMatch(exactEnvIdentifierPattern(MANAGED_API_KEY));
  expect(contents).not.toContain(MANAGED_LICENSE_TOKEN);
}

/** Assert an AgentCore variant deploy script safely materializes its key secret. */
function expectAgentCoreDeployScriptContract(contents: string): void {
  expect(contents).toContain(".env");
  expect(contents).toMatch(exactEnvIdentifierPattern(MANAGED_API_KEY));
  expect(contents).toContain(MANAGED_API_KEY_SECRET_CONFIG);
  expect(contents).toMatch(
    /aws\s+secretsmanager\s+(?:create-secret|put-secret-value)/,
  );
  expect(contents).toMatch(/npx\s+cdk(?:@\S+)?\s+deploy/);
  expect(contents).not.toContain(MANAGED_LICENSE_TOKEN);
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

test("managed documentation helpers reject misleading telemetry semantics", () => {
  const misleadingDescriptions = [
    "authentication credential",
    "entitlement identity",
    "feature enablement identity",
    "analytics consent identity",
    "telemetry send-policy identity",
  ];

  for (const description of misleadingDescriptions) {
    const envExample = `
      # Managed Intelligence credentials
      CPK_INTELLIGENCE_API_KEY=
      # Optional, non-secret analytics ${description}.
      CPK_TELEMETRY_ID=
    `;
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
  const envExample = `
    # Managed Intelligence credentials
    CPK_INTELLIGENCE_API_KEY=
    # Optional, non-secret analytics identity.
    CPK_TELEMETRY_ID=
  `;
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

test("managed documentation helpers reject license guidance inside the managed block", () => {
  const envExample = `
    # Managed Intelligence credentials
    CPK_INTELLIGENCE_API_KEY=
    # Optional, non-secret analytics identity
    CPK_TELEMETRY_ID=
    COPILOTKIT_LICENSE_TOKEN=
  `;
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
  const envExample = `
    # Managed Intelligence credentials
    CPK_INTELLIGENCE_API_KEY=
    # Optional, non-secret analytics identity
    CPK_TELEMETRY_ID=

    # Self-hosted / offline license
    COPILOTKIT_LICENSE_TOKEN=

    # Troubleshooting
    COPILOTKIT_LICENSE_TOKEN=
  `;
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

test("managed documentation helpers require credentials in one managed block", () => {
  const envExample = `
    # Managed Intelligence credentials
    CPK_INTELLIGENCE_API_KEY=

    # Optional, non-secret analytics identity
    CPK_TELEMETRY_ID=
  `;
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
  const envExample = `
    # Managed Intelligence credentials
    CPK_INTELLIGENCE_API_KEY=
    # Optional, non-secret analytics identity
    CPK_TELEMETRY_ID=

    # Self-hosted / offline license
    COPILOTKIT_LICENSE_TOKEN=
  `;
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
