import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const SCHEMA_VERSION = 1;
const MANIFEST_PATH = "scripts/release/public-api/manifest.v1.json";
const SCHEMA_PATH = "scripts/release/public-api/manifest.schema.v1.json";

type JsonObject = Record<string, unknown>;

export interface Provenance {
  kind: "package-json" | "release-config" | "typescript-ast";
  path: string;
  selector: string;
}

export interface PublicApiManifest {
  $schema: string;
  schemaVersion: number;
  selection: {
    rule: string;
    provenance: Provenance[];
  };
  packages: Array<{
    name: string;
    version: string;
    sourceDirectory: string;
    entrypoints: Array<{
      importPath: string;
      exportKey: string;
      kind: "code" | "metadata" | "style";
      conditions: unknown;
      provenance: Provenance;
    }>;
    compatibility: {
      engines?: JsonObject;
      peerDependencies?: JsonObject;
      optionalPeerDependencies?: string[];
      provenance: Provenance[];
    };
    provenance: {
      name: Provenance;
      version: Provenance;
      releaseScope: Provenance;
    };
  }>;
  runtime: {
    serviceAdapters: SourceApiEntry[];
    hostFactories: SourceApiEntry[];
    agentFactoryModes: Array<{
      type: string;
      configurationKeys: string[];
      provenance: {
        type: Provenance;
        configurationKeys: Provenance;
      };
    }>;
  };
  deprecations: Array<{
    importPath: string;
    symbol: string;
    replacement: {
      importPath: string;
      symbol: string;
    };
    sourceMessage: string;
    provenance: {
      importPath: Provenance;
      symbol: Provenance;
      replacement: Provenance;
      sourceMessage: Provenance;
    };
  }>;
}

interface SourceApiEntry {
  importPath: string;
  symbol: string;
  configurationType?: string;
  configurationKeys: string[];
  provenance: {
    importPath: Provenance;
    symbol: Provenance;
    configurationType?: Provenance;
    configurationKeys: Provenance;
  };
}

interface PackageJson extends JsonObject {
  name?: string;
  version?: string;
  private?: boolean;
  exports?: Record<string, unknown>;
  engines?: JsonObject;
  peerDependencies?: JsonObject;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

interface ReleaseConfig {
  scopes?: Record<string, { packages?: string[] }>;
}

interface HostFactorySpec {
  importPath: string;
  entrySource: string;
  symbol: string;
  declarationPath: string;
  configurationType?: string;
  configurationPath?: string;
}

interface DeprecationSpec {
  importPath: string;
  entrySource: string;
  symbol: string;
  declarationPath: string;
  replacement: {
    importPath: string;
    symbol: string;
  };
}

const HOST_FACTORIES: HostFactorySpec[] = [
  {
    importPath: "@copilotkit/runtime/v2",
    entrySource: "packages/runtime/src/v2/index.ts",
    symbol: "createCopilotRuntimeHandler",
    declarationPath: "packages/runtime/src/v2/runtime/core/fetch-handler.ts",
    configurationType: "CopilotRuntimeHandlerOptions",
  },
  {
    importPath: "@copilotkit/runtime/v2/express",
    entrySource: "packages/runtime/src/v2/express.ts",
    symbol: "createCopilotExpressHandler",
    declarationPath: "packages/runtime/src/v2/runtime/endpoints/express.ts",
    configurationType: "CopilotExpressEndpointParams",
  },
  {
    importPath: "@copilotkit/runtime/v2/hono",
    entrySource: "packages/runtime/src/v2/hono.ts",
    symbol: "createCopilotHonoHandler",
    declarationPath: "packages/runtime/src/v2/runtime/endpoints/hono.ts",
    configurationType: "CopilotEndpointParams",
  },
  {
    importPath: "@copilotkit/runtime/v2/node",
    entrySource: "packages/runtime/src/v2/node.ts",
    symbol: "createCopilotNodeHandler",
    declarationPath:
      "packages/runtime/src/v2/runtime/endpoints/node-fetch-handler.ts",
  },
  {
    importPath: "@copilotkit/runtime/v2/node",
    entrySource: "packages/runtime/src/v2/node.ts",
    symbol: "createCopilotNodeListener",
    declarationPath: "packages/runtime/src/v2/runtime/endpoints/node.ts",
    configurationType: "CopilotRuntimeHandlerOptions",
    configurationPath: "packages/runtime/src/v2/runtime/core/fetch-handler.ts",
  },
];

const DEPRECATIONS: DeprecationSpec[] = [
  ...[
    "LangGraphAgent",
    "LangGraphHttpAgent",
    "TextMessageEvents",
    "ToolCallEvents",
    "CustomEventNames",
    "PredictStateTool",
  ].map((symbol) => ({
    importPath: "@copilotkit/runtime",
    entrySource: "packages/runtime/src/index.ts",
    symbol,
    declarationPath: "packages/runtime/src/lib/index.ts",
    replacement: {
      importPath: "@copilotkit/runtime/langgraph",
      symbol,
    },
  })),
  {
    importPath: "@copilotkit/runtime/v2/express",
    entrySource: "packages/runtime/src/v2/express.ts",
    symbol: "createCopilotEndpointExpress",
    declarationPath: "packages/runtime/src/v2/runtime/endpoints/express.ts",
    replacement: {
      importPath: "@copilotkit/runtime/v2/express",
      symbol: "createCopilotExpressHandler",
    },
  },
  {
    importPath: "@copilotkit/runtime/v2/express",
    entrySource: "packages/runtime/src/v2/express.ts",
    symbol: "createCopilotEndpointSingleRouteExpress",
    declarationPath:
      "packages/runtime/src/v2/runtime/endpoints/express-single.ts",
    replacement: {
      importPath: "@copilotkit/runtime/v2/express",
      symbol: "createCopilotExpressHandler",
    },
  },
  {
    importPath: "@copilotkit/runtime/v2/hono",
    entrySource: "packages/runtime/src/v2/hono.ts",
    symbol: "createCopilotEndpoint",
    declarationPath: "packages/runtime/src/v2/runtime/endpoints/hono.ts",
    replacement: {
      importPath: "@copilotkit/runtime/v2/hono",
      symbol: "createCopilotHonoHandler",
    },
  },
  {
    importPath: "@copilotkit/runtime/v2/hono",
    entrySource: "packages/runtime/src/v2/hono.ts",
    symbol: "createCopilotEndpointSingleRoute",
    declarationPath: "packages/runtime/src/v2/runtime/endpoints/hono-single.ts",
    replacement: {
      importPath: "@copilotkit/runtime/v2/hono",
      symbol: "createCopilotHonoHandler",
    },
  },
  {
    importPath: "@copilotkit/runtime/v2/node",
    entrySource: "packages/runtime/src/v2/node.ts",
    symbol: "createNodeFetchHandler",
    declarationPath:
      "packages/runtime/src/v2/runtime/endpoints/node-fetch-handler.ts",
    replacement: {
      importPath: "@copilotkit/runtime/v2/node",
      symbol: "createCopilotNodeHandler",
    },
  },
  {
    importPath: "@copilotkit/runtime/v2",
    entrySource: "packages/runtime/src/v2/index.ts",
    symbol: "CopilotKitRequestHandler",
    declarationPath: "packages/runtime/src/v2/runtime/index.ts",
    replacement: {
      importPath: "@copilotkit/runtime/v2",
      symbol: "CopilotRuntimeFetchHandler",
    },
  },
  {
    importPath: "@copilotkit/runtime/v2",
    entrySource: "packages/runtime/src/v2/index.ts",
    symbol: "BasicAgent",
    declarationPath: "packages/runtime/src/agent/index.ts",
    replacement: {
      importPath: "@copilotkit/runtime/v2",
      symbol: "BuiltInAgent",
    },
  },
  {
    importPath: "@copilotkit/runtime/v2",
    entrySource: "packages/runtime/src/v2/index.ts",
    symbol: "BasicAgentConfiguration",
    declarationPath: "packages/runtime/src/agent/index.ts",
    replacement: {
      importPath: "@copilotkit/runtime/v2",
      symbol: "BuiltInAgentClassicConfig",
    },
  },
];

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    throw new Error(`Unable to parse ${path}: ${String(error)}`, {
      cause: error,
    });
  }
}

function sourceFile(root: string, path: string): ts.SourceFile {
  const absolutePath = resolve(root, path);
  const text = readFileSync(absolutePath, "utf8");
  return ts.createSourceFile(
    absolutePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function provenance(
  kind: Provenance["kind"],
  path: string,
  selector: string,
): Provenance {
  return { kind, path, selector };
}

function declarationName(node: ts.Node): string | undefined {
  if (
    (ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name
  ) {
    return node.name.text;
  }
  if (ts.isVariableStatement(node)) {
    const names = node.declarationList.declarations
      .map((item) => (ts.isIdentifier(item.name) ? item.name.text : undefined))
      .filter((name): name is string => Boolean(name));
    return names.length === 1 ? names[0] : undefined;
  }
  if (ts.isExportDeclaration(node) && node.exportClause) {
    if (ts.isNamedExports(node.exportClause)) {
      const names = node.exportClause.elements.map((item) => item.name.text);
      return names.length === 1 ? names[0] : undefined;
    }
  }
  return undefined;
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function resolveModule(
  root: string,
  fromPath: string,
  specifier: string,
): string {
  if (!specifier.startsWith(".")) {
    throw new Error(
      `Cannot prove a workspace export through external module ${specifier} from ${fromPath}`,
    );
  }
  const base = resolve(root, dirname(fromPath), specifier);
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  const match = candidates.find(existsSync);
  if (!match) {
    throw new Error(`Cannot resolve ${specifier} from ${fromPath}`);
  }
  return relative(root, match);
}

function findExportedDeclaration(
  root: string,
  path: string,
  symbol: string,
  seen = new Set<string>(),
): { path: string; node: ts.Node } | undefined {
  const key = `${path}:${symbol}`;
  if (seen.has(key)) return undefined;
  seen.add(key);

  const file = sourceFile(root, path);
  for (const statement of file.statements) {
    if (hasExportModifier(statement) && declarationName(statement) === symbol) {
      return { path, node: statement };
    }
    if (!ts.isExportDeclaration(statement)) {
      continue;
    }
    if (!statement.moduleSpecifier) {
      if (
        !statement.exportClause ||
        !ts.isNamedExports(statement.exportClause)
      ) {
        continue;
      }
      const exported = statement.exportClause.elements.find(
        (item) => item.name.text === symbol,
      );
      if (!exported) continue;
      const sourceName = exported.propertyName?.text ?? exported.name.text;
      return (
        findExportedDeclaration(root, path, sourceName, seen) ?? {
          path,
          node: statement,
        }
      );
    }
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
    if (!specifier.startsWith(".")) continue;
    const nextPath = resolveModule(root, path, specifier);
    if (!statement.exportClause) {
      const found = findExportedDeclaration(root, nextPath, symbol, seen);
      if (found) return found;
      continue;
    }
    if (!ts.isNamedExports(statement.exportClause)) continue;
    const exported = statement.exportClause.elements.find(
      (item) => item.name.text === symbol,
    );
    if (!exported) continue;
    const sourceName = exported.propertyName?.text ?? exported.name.text;
    return (
      findExportedDeclaration(root, nextPath, sourceName, seen) ?? {
        path,
        node: statement,
      }
    );
  }
  return undefined;
}

function requireExport(
  root: string,
  entrySource: string,
  symbol: string,
): { path: string; node: ts.Node } {
  const result = findExportedDeclaration(root, entrySource, symbol);
  if (!result) {
    throw new Error(`${symbol} is not exported from ${entrySource}`);
  }
  return result;
}

function findNamedDeclaration(
  root: string,
  path: string,
  name: string,
): ts.Node {
  const matches = sourceFile(root, path).statements.filter(
    (statement) => declarationName(statement) === name,
  );
  if (matches.length > 1 && matches.every(ts.isFunctionDeclaration)) {
    const implementations = matches.filter((statement) => statement.body);
    if (implementations.length === 1) return implementations[0];
  }
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${name} declaration in ${path}, found ${matches.length}`,
    );
  }
  return matches[0];
}

function configurationKeys(
  root: string,
  path: string,
  typeName: string,
): string[] {
  const node = findNamedDeclaration(root, path, typeName);
  if (!ts.isInterfaceDeclaration(node)) {
    throw new Error(`${typeName} in ${path} must be an interface`);
  }
  return node.members
    .filter(ts.isPropertySignature)
    .filter(
      (member) =>
        !ts.getJSDocTags(member).some((tag) => tag.tagName.text === "internal"),
    )
    .map((member) => {
      if (!member.name || !ts.isIdentifier(member.name)) {
        throw new Error(
          `${typeName} in ${path} has an unsupported non-identifier property`,
        );
      }
      return member.name.text;
    });
}

function packageExportKey(importPath: string): string {
  const prefix = "@copilotkit/runtime";
  if (importPath === prefix) return ".";
  if (!importPath.startsWith(`${prefix}/`)) {
    throw new Error(`Unsupported runtime import path ${importPath}`);
  }
  return `.${importPath.slice(prefix.length)}`;
}

function assertRuntimeImportPath(root: string, importPath: string): Provenance {
  const path = "packages/runtime/package.json";
  const manifest = readJson<PackageJson>(resolve(root, path));
  const key = packageExportKey(importPath);
  if (!manifest.exports || !(key in manifest.exports)) {
    throw new Error(`${importPath} is not exported by ${path}`);
  }
  return provenance("package-json", path, `exports[${JSON.stringify(key)}]`);
}

function hostFactories(root: string): SourceApiEntry[] {
  return HOST_FACTORIES.map((spec) => {
    requireExport(root, spec.entrySource, spec.symbol);
    const declaration = findNamedDeclaration(
      root,
      spec.declarationPath,
      spec.symbol,
    );
    if (!ts.isFunctionDeclaration(declaration)) {
      throw new Error(
        `${spec.symbol} in ${spec.declarationPath} is not a function`,
      );
    }
    const configurationPath = spec.configurationPath ?? spec.declarationPath;
    const keys = spec.configurationType
      ? configurationKeys(root, configurationPath, spec.configurationType)
      : [];
    const importProvenance = assertRuntimeImportPath(root, spec.importPath);
    const symbolProvenance = provenance(
      "typescript-ast",
      spec.declarationPath,
      `export function ${spec.symbol}`,
    );
    return {
      importPath: spec.importPath,
      symbol: spec.symbol,
      ...(spec.configurationType
        ? { configurationType: spec.configurationType }
        : {}),
      configurationKeys: keys,
      provenance: {
        importPath: importProvenance,
        symbol: symbolProvenance,
        ...(spec.configurationType
          ? {
              configurationType: provenance(
                "typescript-ast",
                configurationPath,
                `interface ${spec.configurationType}`,
              ),
            }
          : {}),
        configurationKeys: provenance(
          "typescript-ast",
          configurationPath,
          spec.configurationType
            ? `interface ${spec.configurationType} public properties`
            : `function ${spec.symbol} has no configuration object`,
        ),
      },
    };
  });
}

function exportedAdapterModules(root: string): string[] {
  const path = "packages/runtime/src/service-adapters/index.ts";
  const file = sourceFile(root, path);
  return file.statements.flatMap((statement) => {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.exportClause ||
      !statement.moduleSpecifier
    ) {
      return [];
    }
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
    return specifier === "./shared"
      ? []
      : [resolveModule(root, path, specifier)];
  });
}

function constructorConfiguration(
  root: string,
  path: string,
  node: ts.ClassDeclaration,
): { type?: string; keys: string[] } {
  const constructors = node.members.filter(ts.isConstructorDeclaration);
  if (constructors.length === 0) return { keys: [] };
  if (constructors.length !== 1 || constructors[0].parameters.length > 1) {
    throw new Error(
      `${node.name?.text ?? "adapter"} in ${path} has an ambiguous constructor`,
    );
  }
  const parameter = constructors[0].parameters[0];
  if (!parameter) return { keys: [] };
  if (!parameter.type || !ts.isTypeReferenceNode(parameter.type)) {
    throw new Error(
      `${node.name?.text ?? "adapter"} in ${path} has an unsupported constructor type`,
    );
  }
  const typeName = parameter.type.typeName.getText();
  return { type: typeName, keys: configurationKeys(root, path, typeName) };
}

function serviceAdapters(root: string): SourceApiEntry[] {
  const importPath = "@copilotkit/runtime";
  const importProvenance = assertRuntimeImportPath(root, importPath);
  const adapters = exportedAdapterModules(root).flatMap((path) => {
    const file = sourceFile(root, path);
    const classes = new Map(
      file.statements.flatMap((statement) =>
        ts.isClassDeclaration(statement) &&
        statement.name?.text.endsWith("Adapter")
          ? [[statement.name.text, statement] as const]
          : [],
      ),
    );
    const symbols = file.statements.flatMap((statement) => {
      if (
        ts.isClassDeclaration(statement) &&
        statement.name?.text.endsWith("Adapter") &&
        hasExportModifier(statement)
      ) {
        return [
          {
            symbol: statement.name.text,
            implementation: statement,
            selector: `export class ${statement.name.text}`,
          },
        ];
      }
      if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) {
        return [];
      }
      return statement.declarationList.declarations.flatMap((declaration) => {
        if (
          !ts.isIdentifier(declaration.name) ||
          !declaration.name.text.endsWith("Adapter") ||
          !declaration.initializer ||
          !ts.isIdentifier(declaration.initializer)
        ) {
          return [];
        }
        const implementation = classes.get(declaration.initializer.text);
        if (!implementation) {
          throw new Error(
            `${declaration.name.text} in ${path} aliases an unknown adapter class`,
          );
        }
        return [
          {
            symbol: declaration.name.text,
            implementation,
            selector: `export const ${declaration.name.text}`,
          },
        ];
      });
    });
    return symbols.map(({ symbol, implementation, selector }) => {
      requireExport(root, "packages/runtime/src/index.ts", symbol);
      const configuration = constructorConfiguration(
        root,
        path,
        implementation,
      );
      const symbolProvenance = provenance("typescript-ast", path, selector);
      return {
        importPath,
        symbol,
        ...(configuration.type
          ? { configurationType: configuration.type }
          : {}),
        configurationKeys: configuration.keys,
        provenance: {
          importPath: importProvenance,
          symbol: symbolProvenance,
          ...(configuration.type
            ? {
                configurationType: provenance(
                  "typescript-ast",
                  path,
                  `constructor parameter ${configuration.type}`,
                ),
              }
            : {}),
          configurationKeys: provenance(
            "typescript-ast",
            path,
            configuration.type
              ? `interface ${configuration.type} public properties`
              : `class ${implementation.name?.text} has no constructor configuration`,
          ),
        },
      } satisfies SourceApiEntry;
    });
  });
  return adapters.sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  );
}

function agentFactoryModes(
  root: string,
): PublicApiManifest["runtime"]["agentFactoryModes"] {
  const path = "packages/runtime/src/agent/index.ts";
  requireExport(
    root,
    "packages/runtime/src/v2/index.ts",
    "BuiltInAgentFactoryConfig",
  );
  const union = findNamedDeclaration(root, path, "BuiltInAgentFactoryConfig");
  if (!ts.isTypeAliasDeclaration(union) || !ts.isUnionTypeNode(union.type)) {
    throw new Error(`BuiltInAgentFactoryConfig in ${path} must be a union`);
  }
  return union.type.types.map((member) => {
    if (!ts.isTypeReferenceNode(member)) {
      throw new Error(
        `BuiltInAgentFactoryConfig in ${path} has a non-reference member`,
      );
    }
    const typeName = member.typeName.getText();
    const declaration = findNamedDeclaration(root, path, typeName);
    if (!ts.isInterfaceDeclaration(declaration)) {
      throw new Error(`${typeName} in ${path} must be an interface`);
    }
    const typeProperty = declaration.members
      .filter(ts.isPropertySignature)
      .find((property) => property.name?.getText() === "type");
    if (
      !typeProperty?.type ||
      !ts.isLiteralTypeNode(typeProperty.type) ||
      !ts.isStringLiteral(typeProperty.type.literal)
    ) {
      throw new Error(
        `${typeName} in ${path} must have one string literal type`,
      );
    }
    const keys = configurationKeys(root, path, typeName);
    return {
      type: typeProperty.type.literal.text,
      configurationKeys: keys,
      provenance: {
        type: provenance(
          "typescript-ast",
          path,
          `interface ${typeName} property type`,
        ),
        configurationKeys: provenance(
          "typescript-ast",
          path,
          `interface ${typeName} public properties`,
        ),
      },
    };
  });
}

function deprecationMessage(
  node: ts.Node,
  path: string,
  symbol: string,
): string {
  const tags = ts
    .getJSDocTags(node)
    .filter((tag) => tag.tagName.text === "deprecated");
  if (tags.length !== 1 || typeof tags[0].comment !== "string") {
    throw new Error(
      `${symbol} in ${path} must have exactly one textual @deprecated tag`,
    );
  }
  return tags[0].comment.trim();
}

function deprecations(root: string): PublicApiManifest["deprecations"] {
  return DEPRECATIONS.map((spec) => {
    requireExport(root, spec.entrySource, spec.symbol);
    const declaration = findNamedDeclaration(
      root,
      spec.declarationPath,
      spec.symbol,
    );
    const message = deprecationMessage(
      declaration,
      spec.declarationPath,
      spec.symbol,
    );
    if (
      !message.includes(spec.replacement.symbol) ||
      (spec.replacement.importPath !== spec.importPath &&
        !message.includes(spec.replacement.importPath))
    ) {
      throw new Error(
        `${symbolDescription(spec)} has a replacement not proven by its @deprecated tag`,
      );
    }
    const declarationProvenance = provenance(
      "typescript-ast",
      spec.declarationPath,
      `${spec.symbol} @deprecated tag`,
    );
    return {
      importPath: spec.importPath,
      symbol: spec.symbol,
      replacement: spec.replacement,
      sourceMessage: message,
      provenance: {
        importPath: assertRuntimeImportPath(root, spec.importPath),
        symbol: declarationProvenance,
        replacement: declarationProvenance,
        sourceMessage: declarationProvenance,
      },
    };
  }).sort((left, right) =>
    `${left.importPath}:${left.symbol}`.localeCompare(
      `${right.importPath}:${right.symbol}`,
    ),
  );
}

function symbolDescription(spec: DeprecationSpec): string {
  return `${spec.importPath} ${spec.symbol}`;
}

function entrypointKind(value: unknown): "code" | "metadata" | "style" {
  const serialized = JSON.stringify(value);
  if (/\.css(?:"|$)/.test(serialized)) return "style";
  if (/package\.json(?:"|$)/.test(serialized)) return "metadata";
  return "code";
}

function releasePackages(root: string): Map<string, string> {
  const path = "release.config.json";
  const config = readJson<ReleaseConfig>(resolve(root, path));
  if (!config.scopes || typeof config.scopes !== "object") {
    throw new Error(`${path} must define scopes`);
  }
  const result = new Map<string, string>();
  for (const [scope, value] of Object.entries(config.scopes)) {
    if (!Array.isArray(value.packages)) {
      throw new Error(`${path} scope ${scope} must define packages`);
    }
    for (const name of value.packages) {
      if (result.has(name)) {
        throw new Error(`${name} appears in multiple release scopes`);
      }
      result.set(name, scope);
    }
  }
  return result;
}

function publicPackages(root: string): PublicApiManifest["packages"] {
  const released = releasePackages(root);
  const packagesRoot = resolve(root, "packages");
  const packagePaths = readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/package.json`)
    .filter((path) => existsSync(resolve(root, path)));

  const publicManifests = packagePaths.flatMap((path) => {
    const manifest = readJson<PackageJson>(resolve(root, path));
    return manifest.name?.startsWith("@copilotkit/") &&
      manifest.private !== true
      ? [{ path, manifest }]
      : [];
  });
  const names = new Set(publicManifests.map(({ manifest }) => manifest.name));
  const missingFromRelease = [...names].filter((name) => !released.has(name!));
  const staleReleasePackages = [...released.keys()].filter(
    (name) => !names.has(name),
  );
  if (missingFromRelease.length || staleReleasePackages.length) {
    throw new Error(
      `Public package/release scope mismatch (missing: ${missingFromRelease.join(", ") || "none"}; stale: ${staleReleasePackages.join(", ") || "none"})`,
    );
  }

  return publicManifests
    .map(({ path, manifest }) => {
      if (
        typeof manifest.name !== "string" ||
        typeof manifest.version !== "string" ||
        !manifest.exports ||
        typeof manifest.exports !== "object"
      ) {
        throw new Error(`${path} lacks name, version, or exports metadata`);
      }
      const packagePath = dirname(path);
      const optionalPeerDependencies = Object.entries(
        manifest.peerDependenciesMeta ?? {},
      )
        .filter(([, metadata]) => metadata.optional === true)
        .map(([name]) => name)
        .sort();
      const compatibilityProvenance: Provenance[] = [];
      if (manifest.engines) {
        compatibilityProvenance.push(
          provenance("package-json", path, "engines"),
        );
      }
      if (manifest.peerDependencies) {
        compatibilityProvenance.push(
          provenance("package-json", path, "peerDependencies"),
        );
      }
      if (optionalPeerDependencies.length) {
        compatibilityProvenance.push(
          provenance("package-json", path, "peerDependenciesMeta.*.optional"),
        );
      }
      return {
        name: manifest.name,
        version: manifest.version,
        sourceDirectory: packagePath,
        entrypoints: Object.entries(manifest.exports)
          .map(([exportKey, conditions]) => ({
            importPath:
              exportKey === "."
                ? manifest.name!
                : `${manifest.name}${exportKey.slice(1)}`,
            exportKey,
            kind: entrypointKind(conditions),
            conditions,
            provenance: provenance(
              "package-json",
              path,
              `exports[${JSON.stringify(exportKey)}]`,
            ),
          }))
          .sort((left, right) =>
            left.importPath.localeCompare(right.importPath),
          ),
        compatibility: {
          ...(manifest.engines ? { engines: manifest.engines } : {}),
          ...(manifest.peerDependencies
            ? { peerDependencies: manifest.peerDependencies }
            : {}),
          ...(optionalPeerDependencies.length
            ? { optionalPeerDependencies }
            : {}),
          provenance: compatibilityProvenance,
        },
        provenance: {
          name: provenance("package-json", path, "name"),
          version: provenance("package-json", path, "version"),
          releaseScope: provenance(
            "release-config",
            "release.config.json",
            `scopes.${released.get(manifest.name)}.packages`,
          ),
        },
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function buildPublicApiManifest(root: string): PublicApiManifest {
  return {
    $schema: "./manifest.schema.v1.json",
    schemaVersion: SCHEMA_VERSION,
    selection: {
      rule: "An immediate packages/* package is public when its name uses the @copilotkit scope, private is not true, and it appears exactly once in release.config.json.",
      provenance: [
        provenance("package-json", "packages/*/package.json", "name, private"),
        provenance(
          "release-config",
          "release.config.json",
          "scopes.*.packages",
        ),
      ],
    },
    packages: publicPackages(root),
    runtime: {
      serviceAdapters: serviceAdapters(root),
      hostFactories: hostFactories(root),
      agentFactoryModes: agentFactoryModes(root),
    },
    deprecations: deprecations(root),
  };
}

export function renderPublicApiManifest(manifest: PublicApiManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function publicApiManifestPath(root: string): string {
  return resolve(root, MANIFEST_PATH);
}

export function publicApiSchemaPath(root: string): string {
  return resolve(root, SCHEMA_PATH);
}
