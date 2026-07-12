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
const INTELLIGENCE_API_URL = "INTELLIGENCE_API_URL";
const INTELLIGENCE_GATEWAY_WS_URL = "INTELLIGENCE_GATEWAY_WS_URL";
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

interface AgentOptionContract {
  readonly property: string;
  readonly environmentReads?: readonly string[];
  readonly stringLiterals?: readonly string[];
}

type RuntimeAgentContract =
  | {
      readonly registration: "default";
      readonly constructorName: string;
      readonly options: readonly AgentOptionContract[];
    }
  | {
      readonly registration: "factory";
      readonly calleePath: readonly string[];
      readonly argumentIdentifier: string;
    };

interface ManagedTemplateContract {
  readonly directory: string;
  readonly frameworks: readonly ManagedCliFramework[];
  readonly runtimePath: string;
  readonly gatePath: string;
  readonly envPath: string;
  readonly readmePath: string;
  readonly runtimeAgent?: RuntimeAgentContract;
  readonly supportedPaths?: {
    readonly localComposePath: string;
    readonly deploymentConfigPath: string;
    readonly runtimeDeploymentPath: string;
    readonly frontendDeploymentPath: string;
    readonly terraformRuntimeDeploymentPath: string;
    readonly terraformReadmePath: string;
    readonly deployScriptPaths: readonly string[];
  };
}

const LANGGRAPH_RUNTIME_AGENT_CONTRACT = {
  registration: "default",
  constructorName: "LangGraphAgent",
  options: [
    {
      property: "deploymentUrl",
      environmentReads: ["AGENT_URL", "LANGGRAPH_DEPLOYMENT_URL"],
      stringLiterals: ["http://localhost:8123"],
    },
    { property: "graphId", stringLiterals: ["sample_agent"] },
    {
      property: "langsmithApiKey",
      environmentReads: ["LANGSMITH_API_KEY"],
    },
  ],
} as const satisfies RuntimeAgentContract;

const LANGGRAPH_FASTAPI_RUNTIME_AGENT_CONTRACT = {
  registration: "default",
  constructorName: "LangGraphHttpAgent",
  options: [
    {
      property: "url",
      environmentReads: ["AGENT_URL"],
      stringLiterals: ["http://localhost:8123"],
    },
  ],
} as const satisfies RuntimeAgentContract;

const HTTP_LOCALHOST_RUNTIME_AGENT_CONTRACT = {
  registration: "default",
  constructorName: "HttpAgent",
  options: [
    {
      property: "url",
      environmentReads: ["AGENT_URL"],
      stringLiterals: ["http://localhost:8000"],
    },
  ],
} as const satisfies RuntimeAgentContract;

const HTTP_LOCALHOST_SLASH_RUNTIME_AGENT_CONTRACT = {
  registration: "default",
  constructorName: "HttpAgent",
  options: [
    {
      property: "url",
      environmentReads: ["AGENT_URL"],
      stringLiterals: ["http://localhost:8000/"],
    },
  ],
} as const satisfies RuntimeAgentContract;

const MASTRA_RUNTIME_AGENT_CONTRACT = {
  registration: "factory",
  calleePath: ["MastraAgent", "getLocalAgents"],
  argumentIdentifier: "mastra",
} as const satisfies RuntimeAgentContract;

const LLAMAINDEX_RUNTIME_AGENT_CONTRACT = {
  registration: "default",
  constructorName: "LlamaIndexAgent",
  options: [
    {
      property: "url",
      environmentReads: ["AGENT_URL"],
      stringLiterals: ["http://127.0.0.1:9000", "/run"],
    },
  ],
} as const satisfies RuntimeAgentContract;

const AGNO_RUNTIME_AGENT_CONTRACT = {
  registration: "default",
  constructorName: "HttpAgent",
  options: [
    {
      property: "url",
      environmentReads: ["AGENT_URL"],
      stringLiterals: ["http://localhost:8000", "/agui"],
    },
  ],
} as const satisfies RuntimeAgentContract;

const STRANDS_RUNTIME_AGENT_CONTRACT = {
  registration: "default",
  constructorName: "HttpAgent",
  options: [
    {
      property: "url",
      environmentReads: ["AGENT_URL", "STRANDS_AGENT_URL"],
      stringLiterals: ["http://localhost:8000"],
    },
  ],
} as const satisfies RuntimeAgentContract;

const MANAGED_TEMPLATE_CONTRACTS = [
  {
    directory: "langgraph-python",
    frameworks: ["langgraph-py", "a2ui", "opengenui"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
    runtimeAgent: LANGGRAPH_RUNTIME_AGENT_CONTRACT,
  },
  {
    directory: "langgraph-js",
    frameworks: ["langgraph-js"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
    runtimeAgent: LANGGRAPH_RUNTIME_AGENT_CONTRACT,
  },
  {
    directory: "langgraph-fastapi",
    frameworks: [],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
    runtimeAgent: LANGGRAPH_FASTAPI_RUNTIME_AGENT_CONTRACT,
  },
  {
    directory: "claude-sdk-typescript",
    frameworks: ["claude-sdk-typescript"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
    runtimeAgent: HTTP_LOCALHOST_RUNTIME_AGENT_CONTRACT,
  },
  {
    directory: "claude-sdk-python",
    frameworks: ["claude-sdk-python"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
    runtimeAgent: HTTP_LOCALHOST_RUNTIME_AGENT_CONTRACT,
  },
  {
    directory: "crewai-flows",
    frameworks: ["flows"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
    runtimeAgent: HTTP_LOCALHOST_RUNTIME_AGENT_CONTRACT,
  },
  {
    directory: "mastra",
    frameworks: ["mastra"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
    runtimeAgent: MASTRA_RUNTIME_AGENT_CONTRACT,
  },
  {
    directory: "pydantic-ai",
    frameworks: ["pydantic-ai"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
    runtimeAgent: HTTP_LOCALHOST_SLASH_RUNTIME_AGENT_CONTRACT,
  },
  {
    directory: "llamaindex",
    frameworks: ["llamaindex"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
    runtimeAgent: LLAMAINDEX_RUNTIME_AGENT_CONTRACT,
  },
  {
    directory: "agno",
    frameworks: ["agno"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
    runtimeAgent: AGNO_RUNTIME_AGENT_CONTRACT,
  },
  {
    directory: "adk",
    frameworks: ["adk"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
    runtimeAgent: HTTP_LOCALHOST_SLASH_RUNTIME_AGENT_CONTRACT,
  },
  {
    directory: "strands-python",
    frameworks: ["aws-strands-py"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
    runtimeAgent: STRANDS_RUNTIME_AGENT_CONTRACT,
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
    runtimeAgent: HTTP_LOCALHOST_SLASH_RUNTIME_AGENT_CONTRACT,
  },
  {
    directory: "ms-agent-framework-python",
    frameworks: ["microsoft-agent-framework-py"],
    runtimePath: "src/app/api/copilotkit/[[...slug]]/route.ts",
    gatePath: "next.config.ts",
    envPath: ".env.example",
    readmePath: "README.md",
    runtimeAgent: HTTP_LOCALHOST_SLASH_RUNTIME_AGENT_CONTRACT,
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
      terraformRuntimeDeploymentPath:
        "infra-terraform/modules/backend/copilotkit_runtime.tf",
      terraformReadmePath: "infra-terraform/README.md",
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

/** Returns whether an expression contains one exact string literal. */
function expressionContainsStringLiteral(
  expression: ts.Expression,
  expected: string,
): boolean {
  let found = false;

  /** Visits one initializer node looking for the required literal. */
  function visit(node: ts.Node): void {
    if (found) return;
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === expected
    ) {
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

/** Returns the expression assigned to one exact object-literal property. */
function objectPropertyExpression(
  objectLiteral: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | null {
  for (const property of objectLiteral.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      propertyNameText(property.name) === name
    ) {
      return property.initializer;
    }
    if (
      ts.isShorthandPropertyAssignment(property) &&
      property.name.text === name
    ) {
      return property.name;
    }
  }

  return null;
}

/** Returns whether the Runtime's Intelligence client owns the API-key read. */
function hasRuntimeApiKeyRead(sourceFile: ts.SourceFile): boolean {
  return newExpressionOptions(sourceFile, "CopilotRuntime").some(
    (runtimeOptions) => {
      const intelligence = objectPropertyExpression(
        runtimeOptions,
        "intelligence",
      );
      if (!intelligence) return false;

      const client = resolveTopLevelExpression(sourceFile, intelligence);
      if (
        !ts.isNewExpression(client) ||
        !ts.isIdentifier(client.expression) ||
        client.expression.text !== "CopilotKitIntelligence"
      ) {
        return false;
      }

      const options = client.arguments?.[0]
        ? unwrapExpression(client.arguments[0])
        : null;
      if (!options || !ts.isObjectLiteralExpression(options)) return false;

      const apiKey = objectPropertyAssignment(options, "apiKey");
      return Boolean(
        apiKey && expressionUsesManagedKeyWithoutTelemetry(apiKey.initializer),
      );
    },
  );
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

/** Returns every variable initializer with one exact identifier in a source tree. */
function variableInitializers(
  root: ts.Node,
  identifier: string,
): readonly ts.Expression[] {
  const matches: ts.Expression[] = [];

  /** Visits variable declarations for the requested identifier. */
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === identifier &&
      node.initializer
    ) {
      matches.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  }

  visit(root);
  return matches;
}

/** Resolves transparent wrappers and top-level variable aliases. */
function resolveTopLevelExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  seenIdentifiers: ReadonlySet<string> = new Set(),
): ts.Expression {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isIdentifier(unwrapped) || seenIdentifiers.has(unwrapped.text)) {
    return unwrapped;
  }

  const initializer = topLevelVariableInitializer(sourceFile, unwrapped.text);
  if (!initializer) return unwrapped;

  return resolveTopLevelExpression(
    sourceFile,
    initializer,
    new Set([...seenIdentifiers, unwrapped.text]),
  );
}

/** Resolves one registered agent through an optional top-level identifier. */
function registeredAgentExpression(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): ts.Expression {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isIdentifier(unwrapped)) return unwrapped;

  const initializer = topLevelVariableInitializer(sourceFile, unwrapped.text);
  return initializer ? unwrapExpression(initializer) : unwrapped;
}

/** Returns whether an object property carries one exact identifier. */
function objectPropertyIsIdentifier(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
  identifier: string,
): boolean {
  return objectLiteral.properties.some((property) => {
    if (
      ts.isShorthandPropertyAssignment(property) &&
      property.name.text === propertyName
    ) {
      return property.name.text === identifier;
    }
    if (
      ts.isPropertyAssignment(property) &&
      propertyNameText(property.name) === propertyName
    ) {
      const initializer = unwrapExpression(property.initializer);
      return ts.isIdentifier(initializer) && initializer.text === identifier;
    }

    return false;
  });
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

/** Returns every object-literal options argument for one constructor. */
function newExpressionOptions(
  sourceFile: ts.SourceFile,
  constructorName: string,
): readonly ts.ObjectLiteralExpression[] {
  const matches: ts.ObjectLiteralExpression[] = [];

  /** Visits constructor calls for exact constructor ownership. */
  function visit(node: ts.Node): void {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === constructorName
    ) {
      const options = node.arguments?.[0]
        ? unwrapExpression(node.arguments[0])
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

/** Returns one constructor's object-literal options from an exact expression. */
function constructorOptionsFromExpression(
  expression: ts.Expression,
  constructorName: string,
): ts.ObjectLiteralExpression | null {
  const unwrapped = unwrapExpression(expression);
  if (
    !ts.isNewExpression(unwrapped) ||
    !ts.isIdentifier(unwrapped.expression) ||
    unwrapped.expression.text !== constructorName
  ) {
    return null;
  }

  const options = unwrapped.arguments?.[0]
    ? unwrapExpression(unwrapped.arguments[0])
    : null;
  return options && ts.isObjectLiteralExpression(options) ? options : null;
}

/** Returns whether a source contains a call to one exact function or method. */
function sourceContainsCall(
  sourceFile: ts.SourceFile,
  calleePath: readonly string[],
): boolean {
  let found = false;

  /** Visits call expressions until the required callee is found. */
  function visit(node: ts.Node): void {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      propertyAccessParts(node.expression).join(".") === calleePath.join(".")
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/** Returns calls to one exact function or method. */
function sourceCalls(
  sourceFile: ts.SourceFile,
  calleePath: readonly string[],
): readonly ts.CallExpression[] {
  const matches: ts.CallExpression[] = [];

  /** Visits source nodes for the required callee. */
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      propertyAccessParts(node.expression).join(".") === calleePath.join(".")
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return matches;
}

/** Returns whether source contains an exact environment read. */
function sourceContainsEnvRead(
  sourceFile: ts.SourceFile,
  identifier: string,
): boolean {
  let found = false;

  /** Visits source nodes for the required environment read. */
  function visit(node: ts.Node): void {
    if (found) return;
    if (isProcessEnvRead(node, identifier)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/** Returns the exported HTTP methods assigned to `handle(app)`. */
function exportedEndpointHandlers(
  sourceFile: ts.SourceFile,
): ReadonlySet<string> {
  const methods = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer
        ? unwrapExpression(declaration.initializer)
        : null;
      if (
        ts.isIdentifier(declaration.name) &&
        initializer &&
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        initializer.expression.text === "handle" &&
        initializer.arguments.length === 1 &&
        ts.isIdentifier(initializer.arguments[0]) &&
        initializer.arguments[0].text === "app"
      ) {
        methods.add(declaration.name.text);
      }
    }
  }

  return methods;
}

/** Returns static JSX tag text when the tag is not computed. */
function jsxTagNameText(name: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  if (ts.isPropertyAccessExpression(name)) {
    return propertyAccessParts(name).join(".");
  }

  return null;
}

/** Returns all JSX elements and self-closing elements with one tag name. */
function jsxNodesWithTag(
  root: ts.Node,
  tagName: string,
): readonly (ts.JsxElement | ts.JsxSelfClosingElement)[] {
  const matches: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];

  /** Visits JSX nodes for the exact tag name. */
  function visit(node: ts.Node): void {
    if (
      ts.isJsxElement(node) &&
      jsxTagNameText(node.openingElement.tagName) === tagName
    ) {
      matches.push(node);
    } else if (
      ts.isJsxSelfClosingElement(node) &&
      jsxTagNameText(node.tagName) === tagName
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(root);
  return matches;
}

/** Returns the opening-like node for a JSX element. */
function jsxOpeningLikeElement(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

/** Returns one exact JSX attribute. */
function jsxAttribute(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  attributeName: string,
): ts.JsxAttribute | null {
  const opening = jsxOpeningLikeElement(node);
  for (const property of opening.attributes.properties) {
    if (
      ts.isJsxAttribute(property) &&
      property.name.getText() === attributeName
    ) {
      return property;
    }
  }

  return null;
}

/** Returns a stable structural identity for one JSX attribute value. */
function jsxAttributeIdentity(
  attribute: ts.JsxAttribute | null,
): string | null {
  if (!attribute?.initializer) {
    return attribute ? "true" : null;
  }
  if (ts.isStringLiteral(attribute.initializer)) {
    return JSON.stringify(attribute.initializer.text);
  }
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression
  ) {
    return attribute.initializer.expression.getText();
  }

  return null;
}

/** Returns whether a JSX attribute is the boolean literal `false`. */
function jsxAttributeIsFalse(attribute: ts.JsxAttribute | null): boolean {
  return Boolean(
    attribute?.initializer &&
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword,
  );
}

/** Returns whether an object property is one exact string literal. */
function objectPropertyIsString(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
  expected: string,
): boolean {
  const property = objectPropertyAssignment(objectLiteral, propertyName);
  if (!property) return false;
  const initializer = unwrapExpression(property.initializer);
  return ts.isStringLiteral(initializer) && initializer.text === expected;
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

/** Asserts one ordinary template retains its framework-specific Runtime agent. */
function expectRuntimeAgentContract(
  contents: string,
  contract: RuntimeAgentContract,
): void {
  const sourceFile = parseManagedSource(contents);
  const runtimeOptions = newExpressionOptions(sourceFile, "CopilotRuntime");

  expect(runtimeOptions).toHaveLength(1);
  if (runtimeOptions.length !== 1) return;
  const agents = objectPropertyAssignment(runtimeOptions[0]!, "agents");
  expect(agents).not.toBeNull();
  if (!agents) return;
  const registeredAgents = unwrapExpression(agents.initializer);

  if (contract.registration === "factory") {
    expect(ts.isCallExpression(registeredAgents)).toBe(true);
    if (!ts.isCallExpression(registeredAgents)) return;
    expect(propertyAccessParts(registeredAgents.expression)).toEqual(
      contract.calleePath,
    );
    const argument = registeredAgents.arguments[0]
      ? unwrapExpression(registeredAgents.arguments[0])
      : null;
    expect(argument && ts.isObjectLiteralExpression(argument)).toBe(true);
    if (!argument || !ts.isObjectLiteralExpression(argument)) return;
    expect(
      objectPropertyIsIdentifier(
        argument,
        contract.argumentIdentifier,
        contract.argumentIdentifier,
      ),
    ).toBe(true);
    return;
  }

  expect(ts.isObjectLiteralExpression(registeredAgents)).toBe(true);
  if (!ts.isObjectLiteralExpression(registeredAgents)) return;
  const defaultAgent = objectPropertyAssignment(registeredAgents, "default");
  expect(defaultAgent).not.toBeNull();
  if (!defaultAgent) return;
  const agent = registeredAgentExpression(sourceFile, defaultAgent.initializer);
  expect(ts.isNewExpression(agent)).toBe(true);
  if (!ts.isNewExpression(agent)) return;
  expect(propertyAccessParts(agent.expression)).toEqual([
    contract.constructorName,
  ]);
  const agentOptions = agent.arguments?.[0]
    ? unwrapExpression(agent.arguments[0])
    : null;
  expect(agentOptions && ts.isObjectLiteralExpression(agentOptions)).toBe(true);
  if (!agentOptions || !ts.isObjectLiteralExpression(agentOptions)) return;

  for (const optionContract of contract.options) {
    const option = objectPropertyAssignment(
      agentOptions,
      optionContract.property,
    );
    expect(option).not.toBeNull();
    if (!option) continue;
    for (const identifier of optionContract.environmentReads ?? []) {
      expect(expressionContainsEnvRead(option.initializer, identifier)).toBe(
        true,
      );
    }
    for (const literal of optionContract.stringLiterals ?? []) {
      expect(expressionContainsStringLiteral(option.initializer, literal)).toBe(
        true,
      );
    }
  }
}

/** Asserts a Next/Hono runtime preserves its complete REST handler surface. */
function expectEndpointHandlerContract(contents: string): void {
  const handlers = exportedEndpointHandlers(parseManagedSource(contents));

  expect([...handlers].sort()).toEqual(["DELETE", "GET", "PATCH", "POST"]);
}

/** Asserts a frontend preserves REST transport and shared thread ownership. */
function expectFrontendThreadContract(
  providerContents: string,
  threadContents: string,
): void {
  const providerSource = parseManagedSource(providerContents);
  const threadSource = parseManagedSource(threadContents);
  const providers = [
    ...jsxNodesWithTag(providerSource, "CopilotKit"),
    ...jsxNodesWithTag(providerSource, "CopilotKitProvider"),
  ];
  const configurationProviders = jsxNodesWithTag(
    threadSource,
    "CopilotChatConfigurationProvider",
  );
  const drawers = jsxNodesWithTag(threadSource, "CopilotThreadsDrawer");

  expect(providers).toHaveLength(1);
  expect(configurationProviders).toHaveLength(1);
  expect(drawers).toHaveLength(1);
  if (
    providers.length !== 1 ||
    configurationProviders.length !== 1 ||
    drawers.length !== 1
  ) {
    return;
  }

  const provider = providers[0]!;
  const configurationProvider = configurationProviders[0]!;
  const drawer = drawers[0]!;
  const configuredAgent = jsxAttributeIdentity(
    jsxAttribute(configurationProvider, "agentId"),
  );
  const drawerAgent = jsxAttributeIdentity(jsxAttribute(drawer, "agentId"));

  expect(jsxAttribute(provider, "runtimeUrl")).not.toBeNull();
  expect(jsxAttributeIsFalse(jsxAttribute(provider, "useSingleEndpoint"))).toBe(
    true,
  );
  expect(jsxAttribute(configurationProvider, "threadId")).toBeNull();
  expect(configuredAgent).not.toBeNull();
  expect(drawerAgent).toBe(configuredAgent);
  expect(
    jsxNodesWithTag(configurationProvider, "CopilotThreadsDrawer"),
  ).toHaveLength(1);

  const configuredChatCount = [
    "CopilotChat",
    "CopilotSidebar",
    "Chat",
    "ResearchAssistant",
  ].reduce(
    (count, tagName) =>
      count + jsxNodesWithTag(configurationProvider, tagName).length,
    0,
  );
  expect(configuredChatCount).toBeGreaterThan(0);
}

/** Asserts MCP Apps retains its client middleware configuration. */
function expectMcpAppsRuntimeBehavior(contents: string): void {
  const sourceFile = parseManagedSource(contents);
  const middlewareOptions = newExpressionOptions(
    sourceFile,
    "MCPAppsMiddleware",
  );
  const agentOptions = newExpressionOptions(sourceFile, "BuiltInAgent");

  expect(middlewareOptions).toHaveLength(1);
  expect(agentOptions).toHaveLength(1);
  expect(sourceContainsCall(sourceFile, ["agent", "use"])).toBe(true);
  if (middlewareOptions.length !== 1) return;

  const serversProperty = objectPropertyAssignment(
    middlewareOptions[0]!,
    "mcpServers",
  );
  const servers = serversProperty
    ? unwrapExpression(serversProperty.initializer)
    : null;
  expect(servers && ts.isArrayLiteralExpression(servers)).toBe(true);
  if (!servers || !ts.isArrayLiteralExpression(servers)) return;

  const configuredServers = servers.elements.filter(
    ts.isObjectLiteralExpression,
  );
  expect(configuredServers).toHaveLength(1);
  if (configuredServers.length !== 1) return;
  expect(objectPropertyIsString(configuredServers[0]!, "type", "http")).toBe(
    true,
  );
  expect(
    objectPropertyIsString(configuredServers[0]!, "serverId", "threejs"),
  ).toBe(true);
  expect(
    objectPropertyIsString(
      configuredServers[0]!,
      "url",
      "http://localhost:3108/mcp",
    ),
  ).toBe(true);
}

/** Asserts the bundled MCP server retains its tools and UI resource. */
function expectMcpServerBehavior(
  serverContents: string,
  transportContents: string,
): void {
  const serverSource = parseManagedSource(serverContents);
  const transportSource = parseManagedSource(transportContents);
  const appToolCalls = sourceCalls(serverSource, ["registerAppTool"]);
  const toolCalls = sourceCalls(serverSource, ["server", "registerTool"]);
  const resourceCalls = sourceCalls(serverSource, ["registerAppResource"]);
  const routeCalls = sourceCalls(transportSource, ["app", "all"]);

  expect(appToolCalls).toHaveLength(1);
  expect(toolCalls).toHaveLength(1);
  expect(resourceCalls).toHaveLength(1);
  expect(routeCalls).toHaveLength(1);
  expect(appToolCalls[0]?.arguments[1]).toMatchObject({
    text: "show_threejs_scene",
  });
  expect(toolCalls[0]?.arguments[0]).toMatchObject({ text: "learn_threejs" });
  expect(sourceContainsCall(serverSource, ["startServer"])).toBe(true);
  expect(sourceContainsCall(transportSource, ["server", "connect"])).toBe(true);
  expect(
    sourceContainsCall(transportSource, ["transport", "handleRequest"]),
  ).toBe(true);
  expect(routeCalls[0]?.arguments[0]).toMatchObject({ text: "/mcp" });

  const resourceArgument = resourceCalls[0]?.arguments[1];
  expect(resourceArgument && ts.isIdentifier(resourceArgument)).toBe(true);
  expect(serverContents).toContain(
    'const resourceUri = "ui://threejs/mcp-app.html"',
  );
}

/** Returns whether source declares one class extending the expected base. */
function sourceContainsClassExtension(
  sourceFile: ts.SourceFile,
  className: string,
  baseName: string,
): boolean {
  let found = false;

  /** Visits class declarations for the exact inheritance edge. */
  function visit(node: ts.Node): void {
    if (found) return;
    if (
      ts.isClassDeclaration(node) &&
      node.name?.text === className &&
      node.heritageClauses?.some(
        (clause) =>
          clause.token === ts.SyntaxKind.ExtendsKeyword &&
          clause.types.some(
            (type) =>
              ts.isIdentifier(type.expression) &&
              type.expression.text === baseName,
          ),
      )
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

/** Asserts A2A retains isolated multi-agent routing and URL ownership. */
function expectA2ARuntimeBehavior(contents: string): void {
  const sourceFile = parseManagedSource(contents);
  const runtimeOptions = newExpressionOptions(
    sourceFile,
    "RuntimeA2AMiddlewareAgent",
  ).find((options) => objectPropertyAssignment(options, "agentUrls"));

  expect(
    sourceContainsClassExtension(
      sourceFile,
      "RuntimeA2AMiddlewareAgent",
      "A2AMiddlewareAgent",
    ),
  ).toBe(true);
  expect(newExpressionOptions(sourceFile, "A2AMiddlewareAgent")).toHaveLength(
    1,
  );
  expect(
    newExpressionOptions(sourceFile, "HttpAgent").length,
  ).toBeGreaterThanOrEqual(2);
  expect(sourceContainsCall(sourceFile, ["isolatedAgent", "setMessages"])).toBe(
    true,
  );
  expect(sourceContainsCall(sourceFile, ["isolatedAgent", "runAgent"])).toBe(
    true,
  );
  for (const identifier of [
    "RESEARCH_AGENT_URL",
    "ANALYSIS_AGENT_URL",
    "ORCHESTRATOR_URL",
  ]) {
    expect(sourceContainsEnvRead(sourceFile, identifier)).toBe(true);
  }

  expect(runtimeOptions).toBeDefined();
  if (!runtimeOptions) return;
  expect(objectPropertyIsString(runtimeOptions, "agentId", "a2a_chat")).toBe(
    true,
  );
  const agentUrls = objectPropertyAssignment(runtimeOptions, "agentUrls");
  const orchestrationAgentUrl = objectPropertyAssignment(
    runtimeOptions,
    "orchestrationAgentUrl",
  );
  expect(agentUrls?.initializer.getText()).toBe(
    "[researchAgentUrl, analysisAgentUrl]",
  );
  expect(orchestrationAgentUrl?.initializer.getText()).toBe("orchestratorUrl");
}

/** Asserts A2A visualization stays registered inside the configured chat. */
function expectA2AVisualizationBehavior(contents: string): void {
  const sourceFile = parseManagedSource(contents);
  const toolCalls = sourceCalls(sourceFile, ["useFrontendTool"]);
  const visualizationTool = toolCalls.find((call) => {
    const options = call.arguments[0]
      ? unwrapExpression(call.arguments[0])
      : null;
    return (
      options &&
      ts.isObjectLiteralExpression(options) &&
      objectPropertyIsString(options, "name", "send_message_to_a2a_agent")
    );
  });

  expect(visualizationTool).toBeDefined();
  expect(jsxNodesWithTag(sourceFile, "MessageToA2A")).toHaveLength(1);
  expect(jsxNodesWithTag(sourceFile, "MessageFromA2A")).toHaveLength(1);
  expect(jsxNodesWithTag(sourceFile, "CopilotChat")).toHaveLength(1);
  expect(jsxNodesWithTag(sourceFile, "CopilotKit")).toHaveLength(0);
  expect(jsxNodesWithTag(sourceFile, "CopilotKitProvider")).toHaveLength(0);
}

/** Asserts AgentCore selects managed Intelligence or its custom local runner. */
function expectAgentCoreRuntimeBehavior(contents: string): void {
  const sourceFile = parseManagedSource(contents);
  const endpointCalls = sourceCalls(sourceFile, ["createCopilotEndpoint"]);
  const requiredAgentUrl = sourceCalls(sourceFile, ["requireEnv"]).some(
    (call) =>
      call.arguments[0] &&
      ts.isStringLiteral(call.arguments[0]) &&
      call.arguments[0].text === "AGENTCORE_AG_UI_URL",
  );

  expect(
    sourceContainsClassExtension(
      sourceFile,
      "AgentCoreRunner",
      "InMemoryAgentRunner",
    ),
  ).toBe(true);
  expect(requiredAgentUrl).toBe(true);
  expect(newExpressionOptions(sourceFile, "HttpAgent")).toHaveLength(1);
  expect(newExpressionOptions(sourceFile, "MCPAppsMiddleware")).toHaveLength(1);

  const runtimeInitializers = variableInitializers(sourceFile, "runtime");
  expect(runtimeInitializers).toHaveLength(1);
  const runtimeSelection = runtimeInitializers[0]
    ? unwrapExpression(runtimeInitializers[0])
    : null;
  expect(runtimeSelection && ts.isConditionalExpression(runtimeSelection)).toBe(
    true,
  );
  if (!runtimeSelection || !ts.isConditionalExpression(runtimeSelection)) {
    return;
  }

  expect(
    expressionUsesManagedKeyWithoutTelemetry(runtimeSelection.condition),
  ).toBe(true);
  const managedOptions = constructorOptionsFromExpression(
    runtimeSelection.whenTrue,
    "CopilotRuntime",
  );
  const localOptions = constructorOptionsFromExpression(
    runtimeSelection.whenFalse,
    "CopilotRuntime",
  );
  expect(managedOptions).not.toBeNull();
  expect(localOptions).not.toBeNull();
  if (!managedOptions || !localOptions) return;

  expect(
    objectPropertyExpression(managedOptions, "intelligence"),
  ).not.toBeNull();
  expect(objectPropertyExpression(managedOptions, "runner")).toBeNull();
  expect(objectPropertyExpression(localOptions, "intelligence")).toBeNull();
  const localRunner = objectPropertyExpression(localOptions, "runner");
  expect(localRunner).not.toBeNull();
  expect(
    localRunner &&
      ts.isNewExpression(unwrapExpression(localRunner)) &&
      ts.isIdentifier(unwrapExpression(localRunner).expression) &&
      unwrapExpression(localRunner).expression.text === "AgentCoreRunner",
  ).toBe(true);
  expect(endpointCalls).toHaveLength(1);
  const endpointOptions = endpointCalls[0]?.arguments[0];
  const unwrappedOptions = endpointOptions
    ? unwrapExpression(endpointOptions)
    : null;
  expect(
    unwrappedOptions && ts.isObjectLiteralExpression(unwrappedOptions),
  ).toBe(true);
  if (!unwrappedOptions || !ts.isObjectLiteralExpression(unwrappedOptions)) {
    return;
  }
  expect(
    objectPropertyIsString(unwrappedOptions, "basePath", "/copilotkit"),
  ).toBe(true);
}

/** Asserts AgentCore local services retain bridge routing and one network. */
function expectAgentCoreNetworkingBehavior(contents: string): void {
  const agent = yamlMappingSection(contents, "agent");
  const bridge = yamlMappingSection(contents, "bridge");
  const frontend = yamlMappingSection(contents, "frontend");

  expect(agent).toMatch(/networks:\s*\n\s*- agentcore-network/);
  expect(bridge).toContain("AGENTCORE_AG_UI_URL=http://agent:8080/invocations");
  expect(bridge).toMatch(
    /depends_on:\s*\n\s*agent:\s*\n\s*condition: service_healthy/,
  );
  expect(bridge).toMatch(/networks:\s*\n\s*- agentcore-network/);
  expect(frontend).toMatch(
    /depends_on:\s*\n\s*bridge:\s*\n\s*condition: service_started/,
  );
  expect(frontend).toMatch(/networks:\s*\n\s*- agentcore-network/);
  expect(contents).toMatch(
    /^networks:\s*\n\s*agentcore-network:\s*\n\s*driver: bridge\s*$/m,
  );
}

/** Asserts an AgentCore deploy script preserves one framework variant. */
function expectAgentCoreVariantBehavior(
  contents: string,
  pattern: string,
  suffix: string,
): void {
  expect(contents).toMatch(new RegExp(`^PATTERN="${pattern}"$`, "m"));
  expect(contents).toMatch(new RegExp(`^SUFFIX="${suffix}"$`, "m"));
  expect(contents).toMatch(/^CONFIG="\$SCRIPT_DIR\/config\.yaml"$/m);
  expect(contents).toMatch(
    /npx cdk@latest deploy --all --require-approval never/,
  );
  expect(contents).toMatch(
    /python3 scripts\/deploy-frontend\.py "\$STACK_NAME"/,
  );
}

/** Returns the provider and thread-owning frontend surfaces for a template. */
function frontendBehaviorPaths(contract: ManagedTemplateContract): {
  readonly providerPath: string;
  readonly threadPath: string;
} {
  if (contract.directory === "agentcore") {
    const chatPath = "frontend/src/components/chat/CopilotKit/index.tsx";
    return { providerPath: chatPath, threadPath: chatPath };
  }
  if (contract.directory === "a2a-middleware") {
    return { providerPath: "app/page.tsx", threadPath: "app/page.tsx" };
  }
  if (contract.directory === "mcp-apps") {
    return { providerPath: "app/layout.tsx", threadPath: "app/page.tsx" };
  }

  return {
    providerPath: "src/app/layout.tsx",
    threadPath: "src/app/page.tsx",
  };
}

/** Assert AgentCore local services consume the CLI-managed root env safely. */
function expectAgentCoreLocalComposeContract(contents: string): void {
  const bridge = yamlMappingSection(contents, "bridge");
  const frontend = yamlMappingSection(contents, "frontend");

  expect(bridge).toMatch(rootManagedEnvFilePattern());
  expect(frontend).toMatch(rootManagedEnvFilePattern());
  expect(frontend).not.toContain(VITE_THREADS_GATE);
  expect(frontend).not.toContain(OPTIONAL_TELEMETRY_ID);
  expect(bridge).not.toMatch(
    new RegExp(`^\\s*-\\s*${INTELLIGENCE_API_URL}=`, "m"),
  );
  expect(bridge).not.toMatch(
    new RegExp(`^\\s*-\\s*${INTELLIGENCE_GATEWAY_WS_URL}=`, "m"),
  );
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
  const telemetryId =
    environmentObject && ts.isObjectLiteralExpression(environmentObject)
      ? objectPropertyAssignment(environmentObject, OPTIONAL_TELEMETRY_ID)
      : null;
  const apiUrl =
    environmentObject && ts.isObjectLiteralExpression(environmentObject)
      ? objectPropertyAssignment(environmentObject, INTELLIGENCE_API_URL)
      : null;
  const gatewayWsUrl =
    environmentObject && ts.isObjectLiteralExpression(environmentObject)
      ? objectPropertyAssignment(environmentObject, INTELLIGENCE_GATEWAY_WS_URL)
      : null;
  expect(managedKey).not.toBeNull();
  expect(telemetryId).not.toBeNull();
  expect(apiUrl).not.toBeNull();
  expect(gatewayWsUrl).not.toBeNull();
  if (!managedKey || !telemetryId || !apiUrl || !gatewayWsUrl) return;

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
  expect(
    expressionContainsEnvRead(telemetryId.initializer, OPTIONAL_TELEMETRY_ID),
  ).toBe(true);
  expect(expressionContainsSecretResolution(telemetryId.initializer)).toBe(
    false,
  );
  expect(
    expressionContainsEnvRead(apiUrl.initializer, INTELLIGENCE_API_URL),
  ).toBe(true);
  expect(
    expressionContainsEnvRead(
      gatewayWsUrl.initializer,
      INTELLIGENCE_GATEWAY_WS_URL,
    ),
  ).toBe(true);
  expect(contents).not.toContain(MANAGED_LICENSE_TOKEN);
}

/** Assert Terraform clearly excludes the managed Intelligence credential path. */
function expectAgentCoreTerraformExclusionContract(
  runtimeDeployment: string,
  readme: string,
): void {
  expect(runtimeDeployment).not.toMatch(
    exactEnvIdentifierPattern(MANAGED_API_KEY),
  );
  expect(runtimeDeployment).not.toMatch(
    exactEnvIdentifierPattern(OPTIONAL_TELEMETRY_ID),
  );
  expect(readme).toMatch(/does not project managed Intelligence credentials/i);
  expect(readme).toMatch(/use the CDK deployment path/i);
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
  expect(contents).not.toMatch(
    exactEnvIdentifierPattern(OPTIONAL_TELEMETRY_ID),
  );
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
  const telemetryExportIndex = lines.findIndex((line) =>
    new RegExp(`^\\s*export\\s+${OPTIONAL_TELEMETRY_ID}(?:=|\\s|$)`).test(line),
  );

  expect(rootEnvLoadIndex).toBeGreaterThanOrEqual(0);
  expect(secretNameVariable).toBeDefined();
  expect(secretCommands.length).toBeGreaterThan(0);
  expect(telemetryExportIndex).toBeGreaterThan(rootEnvLoadIndex);
  expect(cdkDeployIndex).toBeGreaterThan(
    Math.max(telemetryExportIndex, ...secretCommands.map(({ index }) => index)),
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

test.each([
  {
    name: "inline client",
    source: `
      const runtime = new CopilotRuntime({
        agents: {},
        intelligence: new CopilotKitIntelligence({
          apiKey: process.env.CPK_INTELLIGENCE_API_KEY,
        }),
      });
    `,
  },
  {
    name: "bound client",
    source: `
      const intelligence = new CopilotKitIntelligence({
        apiKey: process.env.CPK_INTELLIGENCE_API_KEY,
      });
      const runtime = new CopilotRuntime({ agents: {}, intelligence });
    `,
  },
])(
  "managed Runtime helper accepts a $name wired into the Runtime",
  ({ source }) => {
    expect(() => expectManagedRuntimeContract(source)).not.toThrow();
  },
);

test("managed Runtime helper rejects a configured Intelligence client that is not wired into the Runtime", () => {
  const unusedConfiguredClient = `
    const intelligence = new CopilotKitIntelligence({
      apiKey: process.env.CPK_INTELLIGENCE_API_KEY,
    });
    const runtime = new CopilotRuntime({
      agents: { default: new HttpAgent({ url: "http://localhost:8000" }) },
    });
  `;

  expect(() => expectManagedRuntimeContract(unusedConfiguredClient)).toThrow();
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
        ${OPTIONAL_TELEMETRY_ID}: process.env.${OPTIONAL_TELEMETRY_ID} ?? "",
        ${INTELLIGENCE_API_URL}: process.env.${INTELLIGENCE_API_URL} ?? "http://localhost:4201",
        ${INTELLIGENCE_GATEWAY_WS_URL}: process.env.${INTELLIGENCE_GATEWAY_WS_URL} ?? "ws://localhost:4401",
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
    export ${OPTIONAL_TELEMETRY_ID}
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
      environment: {
        ${MANAGED_API_KEY}: "literal-key",
        ${OPTIONAL_TELEMETRY_ID}: "literal-telemetry-id",
      },
    });
  `;
  const frontendDecoy = `
    // ${VITE_THREADS_GATE} follows props.config.${MANAGED_API_KEY_SECRET_CONFIG}
    new amplify.App(this, "AmplifyApp", {
      environmentVariables: {
        ${VITE_THREADS_GATE}: "enabled",
        ${OPTIONAL_TELEMETRY_ID}: process.env.${OPTIONAL_TELEMETRY_ID},
      },
    });
  `;
  const runtimeTelemetrySecretDecoy = `
    new lambda.Function(this, "CopilotKitRuntimeLambda", {
      environment: {
        ${MANAGED_API_KEY}: cdk.SecretValue.secretsManager(
          config.${MANAGED_API_KEY_SECRET_CONFIG},
        ).unsafeUnwrap(),
        ${OPTIONAL_TELEMETRY_ID}: cdk.SecretValue.secretsManager(
          config.${MANAGED_API_KEY_SECRET_CONFIG},
        ).unsafeUnwrap(),
      },
    });
  `;
  const frontendTelemetryDecoy = `
    new amplify.App(this, "AmplifyApp", {
      environmentVariables: {
        ${VITE_THREADS_GATE}: props.config.${MANAGED_API_KEY_SECRET_CONFIG}
          ? "true"
          : "false",
        ${OPTIONAL_TELEMETRY_ID}: process.env.${OPTIONAL_TELEMETRY_ID},
      },
    });
  `;
  const deployScriptDecoy = `
    # source "$SCRIPT_DIR/.env"
    CPK_SECRET_NAME=$(read_config ${MANAGED_API_KEY_SECRET_CONFIG})
    echo "$${MANAGED_API_KEY}"
    aws secretsmanager create-secret --name unrelated --secret-string literal
    npx cdk deploy --all
    export ${OPTIONAL_TELEMETRY_ID}
  `;
  const lateTelemetryExportDecoy = `
    source "$SCRIPT_DIR/.env"
    CPK_SECRET_NAME=$(read_config ${MANAGED_API_KEY_SECRET_CONFIG})
    aws secretsmanager create-secret --name "$CPK_SECRET_NAME" --secret-string "$${MANAGED_API_KEY}"
    npx cdk deploy --all
    export ${OPTIONAL_TELEMETRY_ID}
  `;

  expect(() =>
    expectAgentCoreRuntimeDeploymentContract(runtimeDecoy),
  ).toThrow();
  expect(() =>
    expectAgentCoreFrontendDeploymentContract(frontendDecoy),
  ).toThrow();
  expect(() =>
    expectAgentCoreRuntimeDeploymentContract(runtimeTelemetrySecretDecoy),
  ).toThrow();
  expect(() =>
    expectAgentCoreFrontendDeploymentContract(frontendTelemetryDecoy),
  ).toThrow();
  expect(() =>
    expectAgentCoreDeployScriptContract(deployScriptDecoy),
  ).toThrow();
  expect(() =>
    expectAgentCoreDeployScriptContract(lateTelemetryExportDecoy),
  ).toThrow();
  expect(() =>
    expectAgentCoreDeploymentConfigContract(
      `${MANAGED_API_KEY_SECRET_CONFIG}: \${${MANAGED_API_KEY}}`,
    ),
  ).toThrow();
});

test("AgentCore deployment helper rejects endpoint literals disconnected from the root env", () => {
  const runtimeDeployment = `
    new lambda.Function(this, "CopilotKitRuntimeLambda", {
      environment: {
        ${MANAGED_API_KEY}: cdk.SecretValue.secretsManager(
          config.${MANAGED_API_KEY_SECRET_CONFIG},
        ).unsafeUnwrap(),
        ${OPTIONAL_TELEMETRY_ID}: process.env.${OPTIONAL_TELEMETRY_ID} ?? "",
        ${INTELLIGENCE_API_URL}: "https://hard-coded.example",
        ${INTELLIGENCE_GATEWAY_WS_URL}: "wss://hard-coded.example",
      },
    });
  `;

  expect(() =>
    expectAgentCoreRuntimeDeploymentContract(runtimeDeployment),
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
    const runtime = new CopilotRuntime({ agents: {}, intelligence });
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
    const runtime = new CopilotRuntime({ agents: {}, intelligence });
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

test("route preservation helper rejects an incomplete handler export set", () => {
  const route = `
    const app = createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" });
    export const GET = handle(app);
    export const POST = handle(app);
    export const PATCH = handle(app);
  `;

  expect(() => expectEndpointHandlerContract(route)).toThrow();
});

test("frontend preservation helper rejects controlled thread state and single-endpoint transport", () => {
  const frontend = `
    export function App() {
      return (
        <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={true}>
          <CopilotChatConfigurationProvider agentId="default" threadId="thread-1">
            <CopilotThreadsDrawer agentId="default" />
            <CopilotChat />
          </CopilotChatConfigurationProvider>
        </CopilotKit>
      );
    }
  `;

  expect(() => expectFrontendThreadContract(frontend, frontend)).toThrow();
});

test("MCP preservation helper rejects a middleware-only scaffold without server behavior", () => {
  const server = `
    export function createServer() {
      return new McpServer({ name: "Three.js Server", version: "1.0.0" });
    }
  `;
  const transport = `
    export function startServer() {
      const app = createMcpExpressApp();
      app.all("/mcp", () => undefined);
    }
  `;

  expect(() => expectMcpServerBehavior(server, transport)).toThrow();
});

test("A2A preservation helper rejects collapsed single-agent routing", () => {
  const route = `
    const agent = new RuntimeA2AMiddlewareAgent({
      agentId: "a2a_chat",
      agentUrls: [],
      orchestrationAgentUrl: "http://localhost:9000",
    });
  `;

  expect(() => expectA2ARuntimeBehavior(route)).toThrow();
});

test("AgentCore preservation helper rejects disconnected local services", () => {
  const compose = `
services:
  agent:
    image: agent
  bridge:
    image: bridge
  frontend:
    image: frontend
`;

  expect(() => expectAgentCoreNetworkingBehavior(compose)).toThrow();
});

test("AgentCore preservation helper rejects a custom runner disconnected from Runtime selection", () => {
  const runtime = `
    class AgentCoreRunner extends InMemoryAgentRunner {}
    const disconnectedRunner = new AgentCoreRunner();
    const runtime = process.env.${MANAGED_API_KEY}
      ? new CopilotRuntime({
          agents: {},
          intelligence: new CopilotKitIntelligence({
            apiKey: process.env.${MANAGED_API_KEY},
          }),
          identifyUser: () => ({ id: "demo-user" }),
        })
      : new CopilotRuntime({
          agents: {},
          runner: new InMemoryAgentRunner(),
        });
    const app = createCopilotEndpoint({ runtime, basePath: "/copilotkit" });
  `;

  expect(() => expectAgentCoreRuntimeBehavior(runtime)).toThrow();
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

test("the 17 managed template directories back all 19 in-repo CLI frameworks", () => {
  const frameworks = MANAGED_TEMPLATE_CONTRACTS.flatMap(
    (contract) => contract.frameworks,
  );
  const ordinaryRuntimeContracts = MANAGED_TEMPLATE_CONTRACTS.filter(
    (contract) => "runtimeAgent" in contract,
  );

  expect(MANAGED_TEMPLATE_CONTRACTS).toHaveLength(17);
  expect(ordinaryRuntimeContracts).toHaveLength(14);
  expect(new Set(frameworks).size).toBe(19);
  expect([...frameworks].sort()).toEqual([...MANAGED_CLI_FRAMEWORKS].sort());
});

test("Mastra explicitly includes its generated managed env example", () => {
  const gitignore = fs.readFileSync(
    path.join(integrationsDir, "mastra", ".gitignore"),
    "utf8",
  );

  expect(gitignore).toMatch(/^!\.env\.example$/m);
});

test.each([
  {
    defect: "registered constructor changes",
    contents: `
      const defaultAgent = new WrongAgent({
        url: process.env.AGENT_URL || "http://localhost:8000/",
      });
      new CopilotRuntime({ agents: { default: defaultAgent } });
    `,
    contract: HTTP_LOCALHOST_SLASH_RUNTIME_AGENT_CONTRACT,
  },
  {
    defect: "required endpoint configuration disappears",
    contents: `
      const defaultAgent = new HttpAgent({
        url: "http://localhost:8000/",
      });
      new CopilotRuntime({ agents: { default: defaultAgent } });
    `,
    contract: HTTP_LOCALHOST_SLASH_RUNTIME_AGENT_CONTRACT,
  },
  {
    defect: "constructed agent is no longer registered",
    contents: `
      const defaultAgent = new HttpAgent({
        url: process.env.AGENT_URL || "http://localhost:8000/",
      });
      new CopilotRuntime({ agents: { default: unregisteredAgent } });
    `,
    contract: HTTP_LOCALHOST_SLASH_RUNTIME_AGENT_CONTRACT,
  },
  {
    defect: "framework factory changes",
    contents: `
      new CopilotRuntime({
        agents: MastraAgent.getRemoteAgents({ mastra }),
      });
    `,
    contract: MASTRA_RUNTIME_AGENT_CONTRACT,
  },
])(
  "the ordinary Runtime agent helper rejects when $defect",
  ({ contents, contract }) => {
    expect(() => expectRuntimeAgentContract(contents, contract)).toThrow();
  },
);

for (const contract of MANAGED_TEMPLATE_CONTRACTS) {
  if ("runtimeAgent" in contract) {
    test(`${contract.directory} runtime preserves its framework-specific agent wiring`, () => {
      const runtime = readManagedSurface(
        contract,
        contract.runtimePath,
        "runtime",
      );

      expectRuntimeAgentContract(runtime, contract.runtimeAgent);
    });
  }

  if (contract.directory !== "agentcore") {
    test(`${contract.directory} runtime preserves all REST endpoint handlers`, () => {
      const runtime = readManagedSurface(
        contract,
        contract.runtimePath,
        "runtime",
      );

      expectEndpointHandlerContract(runtime);
    });
  }

  test(`${contract.directory} frontend preserves REST transport and shared thread context`, () => {
    const frontendPaths = frontendBehaviorPaths(contract);
    const provider = readManagedSurface(
      contract,
      frontendPaths.providerPath,
      "frontend provider",
    );
    const threadSurface = readManagedSurface(
      contract,
      frontendPaths.threadPath,
      "thread surface",
    );

    expectFrontendThreadContract(provider, threadSurface);
  });

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

  if (contract.directory === "mcp-apps") {
    test("mcp-apps runtime preserves its MCP Apps client middleware", () => {
      const runtime = readManagedSurface(
        contract,
        contract.runtimePath,
        "runtime",
      );

      expectMcpAppsRuntimeBehavior(runtime);
    });

    test("mcp-apps preserves its streamable HTTP tools and UI resource server", () => {
      const server = readManagedSurface(
        contract,
        "threejs-server/server.ts",
        "MCP server",
      );
      const transport = readManagedSurface(
        contract,
        "threejs-server/server-utils.ts",
        "MCP transport",
      );

      expectMcpServerBehavior(server, transport);
    });
  }

  if (contract.directory === "a2a-middleware") {
    test("a2a-middleware preserves isolated multi-agent routing", () => {
      const runtime = readManagedSurface(
        contract,
        contract.runtimePath,
        "runtime",
      );

      expectA2ARuntimeBehavior(runtime);
    });

    test("a2a-middleware preserves its configured chat visualization tool", () => {
      const chat = readManagedSurface(
        contract,
        "components/chat.tsx",
        "A2A chat",
      );

      expectA2AVisualizationBehavior(chat);
    });
  }

  if ("supportedPaths" in contract) {
    const supportedPaths = contract.supportedPaths;
    test(`${contract.directory} runtime preserves AgentCore bridge behavior`, () => {
      const runtime = readManagedSurface(
        contract,
        contract.runtimePath,
        "runtime",
      );

      expectAgentCoreRuntimeBehavior(runtime);
    });

    test(`${contract.directory} local Compose preserves service networking`, () => {
      const compose = readManagedSurface(
        contract,
        supportedPaths.localComposePath,
        "local Compose config",
      );

      expectAgentCoreNetworkingBehavior(compose);
    });

    test(`${contract.directory} deploy scripts preserve LangGraph and Strands variants`, () => {
      const variants = [
        {
          path: supportedPaths.deployScriptPaths[0]!,
          pattern: "langgraph-single-agent",
          suffix: "-lg",
        },
        {
          path: supportedPaths.deployScriptPaths[1]!,
          pattern: "strands-single-agent",
          suffix: "-st",
        },
      ];

      for (const variant of variants) {
        const deployScript = readManagedSurface(
          contract,
          variant.path,
          "deploy script",
        );
        expectAgentCoreVariantBehavior(
          deployScript,
          variant.pattern,
          variant.suffix,
        );
        expect(
          fs.existsSync(
            path.join(
              integrationsDir,
              contract.directory,
              "agents",
              variant.pattern,
            ),
          ),
        ).toBe(true);
      }
    });

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

    test(`${contract.directory} explicitly excludes managed credentials from Terraform`, () => {
      const terraformRuntimeDeployment = readManagedSurface(
        contract,
        supportedPaths.terraformRuntimeDeploymentPath,
        "Terraform runtime deployment",
      );
      const terraformReadme = readManagedSurface(
        contract,
        supportedPaths.terraformReadmePath,
        "Terraform README",
      );

      expectAgentCoreTerraformExclusionContract(
        terraformRuntimeDeployment,
        terraformReadme,
      );
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
