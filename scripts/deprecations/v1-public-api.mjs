import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { pilotMappings } from "./v1-source-mappings.mjs";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export const MIGRATION_GUIDE = "https://docs.copilotkit.ai/migrate/v2";
export const V2_REFERENCE = "https://docs.copilotkit.ai/reference/v2";

export const v1Entrypoints = [
  {
    id: "react-core",
    file: "packages/react-core/src/index.tsx",
    packageRoot: "packages/react-core",
    importPath: "@copilotkit/react-core",
    v2File: "packages/react-core/src/v2/index.ts",
    v2ImportPath: "@copilotkit/react-core/v2",
    v2Source: "packages/react-core/src/v2/index.ts",
    docsKind: "react",
    version: "1.68.2",
    distFiles: [
      "packages/react-core/dist/index.d.mts",
      "packages/react-core/dist/index.d.cts",
    ],
  },
  {
    id: "react-ui",
    file: "packages/react-ui/src/index.tsx",
    packageRoot: "packages/react-ui",
    importPath: "@copilotkit/react-ui",
    v2File: "packages/react-core/src/v2/index.ts",
    v2ImportPath: "@copilotkit/react-core/v2",
    v2Source: "packages/react-core/src/v2/index.ts",
    docsKind: "react",
    version: "1.68.2",
    distFiles: [
      "packages/react-ui/dist/index.d.mts",
      "packages/react-ui/dist/index.d.cts",
    ],
  },
  {
    id: "react-textarea",
    file: "packages/react-textarea/src/index.tsx",
    packageRoot: "packages/react-textarea",
    importPath: "@copilotkit/react-textarea",
    v2File: null,
    v2ImportPath: "@copilotkit/react-core/v2",
    v2Source: "packages/react-core/src/v2/index.ts",
    docsKind: "react",
    version: "1.68.2",
    distFiles: [
      "packages/react-textarea/dist/index.d.mts",
      "packages/react-textarea/dist/index.d.cts",
    ],
  },
  {
    id: "runtime",
    file: "packages/runtime/src/index.ts",
    packageRoot: "packages/runtime",
    importPath: "@copilotkit/runtime",
    v2File: "packages/runtime/src/v2/index.ts",
    v2ImportPath: "@copilotkit/runtime/v2",
    v2Source: "packages/runtime/src/v2/index.ts",
    docsKind: "runtime",
    version: "1.68.2",
    distFiles: [
      "packages/runtime/dist/index.d.mts",
      "packages/runtime/dist/index.d.cts",
    ],
  },
  {
    id: "runtime-langgraph",
    file: "packages/runtime/src/langgraph.ts",
    packageRoot: "packages/runtime",
    importPath: "@copilotkit/runtime/langgraph",
    v2File: "packages/runtime/src/v2/index.ts",
    v2ImportPath: "@copilotkit/runtime/v2",
    v2Source: "packages/runtime/src/v2/index.ts",
    docsKind: "runtime",
    version: "1.68.2",
    distFiles: [
      "packages/runtime/dist/langgraph.d.mts",
      "packages/runtime/dist/langgraph.d.cts",
    ],
  },
  {
    id: "sdk-js",
    file: "packages/sdk-js/src/index.ts",
    packageRoot: "packages/sdk-js",
    importPath: "@copilotkit/sdk-js",
    v2File: null,
    v2ImportPath: "@copilotkit/runtime/v2",
    v2Source: "packages/runtime/src/v2/index.ts",
    docsKind: "runtime",
    version: "1.68.2",
    distFiles: [
      "packages/sdk-js/dist/index.d.mts",
      "packages/sdk-js/dist/index.d.cts",
    ],
  },
  {
    id: "sdk-js-langchain",
    file: "packages/sdk-js/src/langchain.ts",
    packageRoot: "packages/sdk-js",
    importPath: "@copilotkit/sdk-js/langchain",
    v2File: null,
    v2ImportPath: "@copilotkit/runtime/v2",
    v2Source: "packages/runtime/src/v2/index.ts",
    docsKind: "runtime",
    version: "1.68.2",
    distFiles: [
      "packages/sdk-js/dist/langchain.d.mts",
      "packages/sdk-js/dist/langchain.d.cts",
    ],
  },
  {
    id: "sdk-js-langgraph",
    file: "packages/sdk-js/src/langgraph/index.ts",
    packageRoot: "packages/sdk-js",
    importPath: "@copilotkit/sdk-js/langgraph",
    v2File: null,
    v2ImportPath: "@copilotkit/runtime/v2",
    v2Source: "packages/runtime/src/v2/index.ts",
    docsKind: "runtime",
    version: "1.68.2",
    distFiles: [
      "packages/sdk-js/dist/langgraph.d.mts",
      "packages/sdk-js/dist/langgraph.d.cts",
    ],
  },
  {
    id: "sdk-js-langgraph-middlewares",
    file: "packages/sdk-js/src/langgraph-middlewares.ts",
    packageRoot: "packages/sdk-js",
    importPath: "@copilotkit/sdk-js/langgraph-middlewares",
    v2File: null,
    v2ImportPath: "@copilotkit/runtime/v2",
    v2Source: "packages/runtime/src/v2/index.ts",
    docsKind: "runtime",
    version: "1.68.2",
    forcedDirectSource: "@ag-ui/langgraph/middlewares",
    distFiles: [
      "packages/sdk-js/dist/langgraph-middlewares.d.mts",
      "packages/sdk-js/dist/langgraph-middlewares.d.cts",
    ],
  },
  {
    id: "vue",
    file: "packages/vue/src/index.ts",
    packageRoot: "packages/vue",
    importPath: "@copilotkit/vue",
    v2File: "packages/vue/src/v2/index.ts",
    v2ImportPath: "@copilotkit/vue/v2",
    v2Source: "packages/vue/src/v2/index.ts",
    docsKind: "vue",
    version: "1.68.2",
    reexportV2From: "./v2",
    distFiles: [
      "packages/vue/dist/index.d.mts",
      "packages/vue/dist/index.d.cts",
    ],
  },
];

const overrides = new Map(
  [
    ["react-core:useCopilotAction", "useFrontendTool"],
    ["react-core:useCopilotAdditionalInstructions", "useAgentContext"],
    ["react-core:useCoAgent", "useAgent"],
    ["react-core:useCopilotChat", "useAgent"],
    ["react-core:useCopilotChatSuggestions", "useConfigureSuggestions"],
    ["react-core:useDefaultTool", "useDefaultRenderTool"],
    ["vue:CopilotKit", "CopilotKitProvider"],
    ["vue:CopilotKitProps", "CopilotKitProviderProps"],
    ["vue:useCopilotAction", "useFrontendTool"],
    ["vue:useCopilotReadable", "useAgentContext"],
  ].map(([key, replacementName]) => [key, { replacementName }]),
);

for (const mapping of pilotMappings) {
  const entrypointId = mapping.file.startsWith("packages/react-core/")
    ? "react-core"
    : mapping.file.startsWith("packages/react-ui/")
      ? "react-ui"
      : "runtime";
  const replacementName = mapping.v2.match(/\{\s*([^\s}]+)\s*\}/)?.[1];
  if (!replacementName) throw new Error(`Invalid v2 import: ${mapping.v2}`);
  overrides.set(`${entrypointId}:${mapping.deprecatedExport}`, {
    replacementName,
    docs: mapping.docs,
    source: mapping.source,
    notes: mapping.notes,
    exampleLines: mapping.deprecationExample,
  });
}

const suggestionsExample = pilotMappings.find(
  (mapping) => mapping.deprecatedExport === "useCopilotChatSuggestions",
)?.deprecationExample;
if (!suggestionsExample) {
  throw new Error("Missing audited useConfigureSuggestions migration example");
}
overrides.set("react-core:useCopilotChatSuggestions", {
  replacementName: "useConfigureSuggestions",
  docs: "https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions",
  source: "packages/react-core/src/v2/hooks/use-configure-suggestions.tsx",
  exampleLines: suggestionsExample,
});

const compilerOptions = {
  allowArbitraryExtensions: true,
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true,
  target: ts.ScriptTarget.ESNext,
};

function resolveAlias(checker, symbol) {
  let resolved = symbol;
  const seen = new Set();
  while (resolved.flags & ts.SymbolFlags.Alias) {
    if (seen.has(resolved)) break;
    seen.add(resolved);
    resolved = checker.getAliasedSymbol(resolved);
  }
  return resolved;
}

function exportSpecifierInfo(symbol) {
  const declaration = symbol.declarations?.find((candidate) =>
    ts.isExportSpecifier(candidate),
  );
  if (!declaration) return null;
  const exportDeclaration = declaration.parent.parent;
  const moduleSpecifier = ts.isExportDeclaration(exportDeclaration)
    ? exportDeclaration.moduleSpecifier
    : null;
  return {
    declaration,
    source:
      moduleSpecifier && ts.isStringLiteral(moduleSpecifier)
        ? moduleSpecifier.text
        : null,
    sourceName: declaration.propertyName?.text ?? declaration.name.text,
    typeOnly: declaration.isTypeOnly || exportDeclaration.isTypeOnly,
  };
}

function modulePathWithoutExtension(file) {
  return file.replace(/(?:\.d)?\.(?:[cm]?[jt]sx?|vue)$/, "");
}

function packageImportForDeclaration(file) {
  const normalized = file.split(path.sep).join("/");
  const packageMatch = normalized.match(/\/packages\/([^/]+)\/(?:dist|src)\//);
  if (packageMatch) {
    const packageJson = path.join(
      repoRoot,
      "packages",
      packageMatch[1],
      "package.json",
    );
    if (existsSync(packageJson)) {
      return JSON.parse(readFileSync(packageJson, "utf8")).name;
    }
  }
  const nodeModulesIndex = normalized.lastIndexOf("/node_modules/");
  if (nodeModulesIndex !== -1) {
    const rest = normalized.slice(nodeModulesIndex + "/node_modules/".length);
    const parts = rest.split("/");
    return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  return null;
}

function isLocalV1Declaration(entrypoint, file) {
  const relative = path.relative(repoRoot, file).split(path.sep).join("/");
  return (
    relative.startsWith(`${entrypoint.packageRoot}/src/`) &&
    !relative.includes("/src/v2/")
  );
}

function sourceSpecifier(entrypoint, declarationFile, publicName, targetNames) {
  if (entrypoint.forcedDirectSource) return entrypoint.forcedDirectSource;
  const relative = path
    .relative(repoRoot, declarationFile)
    .split(path.sep)
    .join("/");
  if (isLocalV1Declaration(entrypoint, declarationFile)) {
    const from = path.dirname(path.join(repoRoot, entrypoint.file));
    let specifier = path
      .relative(from, declarationFile)
      .split(path.sep)
      .join("/");
    specifier = modulePathWithoutExtension(specifier);
    return specifier.startsWith(".") ? specifier : `./${specifier}`;
  }
  if (
    entrypoint.reexportV2From &&
    targetNames.has(publicName) &&
    !relative.startsWith(`${entrypoint.packageRoot}/src/`)
  ) {
    return entrypoint.reexportV2From;
  }
  if (relative.includes(`${entrypoint.packageRoot}/src/v2/`)) return "./v2";
  return packageImportForDeclaration(declarationFile);
}

function docsFor(entrypoint, replacementName, typeOnly) {
  if (entrypoint.docsKind === "runtime") {
    return "https://docs.copilotkit.ai/runtime-server-adapter";
  }
  if (typeOnly) return V2_REFERENCE;
  const base =
    entrypoint.docsKind === "vue"
      ? "showcase/shell-docs/src/content/reference/vue"
      : "showcase/shell-docs/src/content/reference";
  const candidates = replacementName.startsWith("use")
    ? [["hooks", "hooks"]]
    : [
        ["components", "components"],
        ["hooks", "hooks"],
        ["sdk", "sdk"],
      ];
  for (const [folder, urlFolder] of candidates) {
    if (
      existsSync(path.join(repoRoot, base, folder, `${replacementName}.mdx`))
    ) {
      return entrypoint.docsKind === "vue"
        ? `https://docs.copilotkit.ai/reference/vue/${urlFolder}/${replacementName}`
        : `https://docs.copilotkit.ai/reference/v2/${urlFolder}/${replacementName}`;
    }
  }
  return V2_REFERENCE;
}

function identifierSuffix(name) {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, "");
  return cleaned ? `${cleaned[0].toUpperCase()}${cleaned.slice(1)}` : "Api";
}

function defaultExample(name, importPath, typeOnly, declaration) {
  const importLine = typeOnly
    ? `import type { ${name} } from "${importPath}";`
    : `import { ${name} } from "${importPath}";`;
  let usageLine;
  if (typeOnly) {
    usageLine = `type V2${identifierSuffix(name)} = ${name};`;
  } else if (declaration && ts.isClassDeclaration(declaration)) {
    usageLine = `const v2${identifierSuffix(name)} = new ${name}({});`;
  } else if (name.startsWith("use")) {
    usageLine = `${name}({});`;
  } else if (
    /^[A-Z]/.test(name) &&
    declaration &&
    ts.isFunctionDeclaration(declaration)
  ) {
    usageLine = `<${name} />;`;
  } else {
    usageLine = `const v2${identifierSuffix(name)} = ${name};`;
  }
  return { importLine, usageLine, lines: [importLine, usageLine] };
}

export function getV1PublicApi() {
  const rootNames = [
    ...v1Entrypoints.map(({ file }) => path.join(repoRoot, file)),
    ...v1Entrypoints
      .map(({ v2File }) => v2File && path.join(repoRoot, v2File))
      .filter(Boolean),
  ];
  const program = ts.createProgram(rootNames, compilerOptions);
  const checker = program.getTypeChecker();
  const inventories = [];

  for (const entrypoint of v1Entrypoints) {
    const sourceFile = program.getSourceFile(
      path.join(repoRoot, entrypoint.file),
    );
    if (!sourceFile?.symbol)
      throw new Error(`Unable to load ${entrypoint.file}`);
    const targetSource = entrypoint.v2File
      ? program.getSourceFile(path.join(repoRoot, entrypoint.v2File))
      : null;
    const targetExports = targetSource?.symbol
      ? checker.getExportsOfModule(targetSource.symbol)
      : [];
    const targetByName = new Map(
      targetExports.map((symbol) => [symbol.name, symbol]),
    );
    const targetNames = new Set(targetByName.keys());
    const exports = checker
      .getExportsOfModule(sourceFile.symbol)
      .filter((symbol) => symbol.name !== "default")
      .map((symbol) => {
        const resolved = resolveAlias(checker, symbol);
        const specifier = exportSpecifierInfo(symbol);
        const rootSpecifier =
          specifier?.declaration.getSourceFile().fileName ===
          sourceFile.fileName
            ? specifier
            : null;
        const declaration =
          resolved.declarations?.[0] ?? specifier?.declaration;
        if (!declaration) {
          throw new Error(
            `No declaration for ${entrypoint.importPath}:${symbol.name}`,
          );
        }
        const declarationFile = declaration.getSourceFile().fileName;
        const directSource =
          entrypoint.forcedDirectSource ??
          rootSpecifier?.source ??
          sourceSpecifier(
            entrypoint,
            declarationFile,
            symbol.name,
            targetNames,
          );
        if (!directSource) {
          throw new Error(
            `No source module for ${entrypoint.importPath}:${symbol.name}`,
          );
        }
        const override = overrides.get(`${entrypoint.id}:${symbol.name}`);
        const replacementName = override?.replacementName ?? symbol.name;
        const targetSymbol = targetByName.get(replacementName);
        const hasReplacement = Boolean(targetSymbol);
        const resolvedTarget = targetSymbol
          ? resolveAlias(checker, targetSymbol)
          : null;
        const targetSpecifier = targetSymbol
          ? exportSpecifierInfo(targetSymbol)
          : null;
        const typeOnly =
          rootSpecifier?.typeOnly ?? !(resolved.flags & ts.SymbolFlags.Value);
        const replacementTypeOnly = resolvedTarget
          ? (targetSpecifier?.typeOnly ??
            !(resolvedTarget.flags & ts.SymbolFlags.Value))
          : typeOnly;
        const targetDeclaration =
          resolvedTarget?.declarations?.[0] ?? targetSpecifier?.declaration;
        const targetDeclarationFile =
          targetDeclaration?.getSourceFile().fileName;
        const targetRelative = targetDeclarationFile
          ? path
              .relative(repoRoot, targetDeclarationFile)
              .split(path.sep)
              .join("/")
          : null;
        const replacementSource =
          override?.source ??
          (targetRelative?.startsWith("packages/") &&
          !targetRelative.includes("/dist/")
            ? targetRelative
            : entrypoint.v2Source);
        const docs =
          override?.docs ??
          (hasReplacement
            ? docsFor(entrypoint, replacementName, replacementTypeOnly)
            : V2_REFERENCE);
        const example = hasReplacement
          ? override?.exampleLines
            ? {
                importLine: override.exampleLines[0],
                usageLine:
                  override.exampleLines.find(
                    (line) =>
                      line.includes(`${replacementName}(`) ||
                      line.includes(`<${replacementName}`) ||
                      line.includes(`new ${replacementName}`) ||
                      line.startsWith("type "),
                  ) ?? override.exampleLines.at(-1),
                lines: override.exampleLines,
              }
            : defaultExample(
                replacementName,
                entrypoint.v2ImportPath,
                replacementTypeOnly,
                targetDeclaration,
              )
          : null;
        const publicSourceName =
          directSource === "./v2" || directSource === entrypoint.reexportV2From
            ? symbol.name
            : (rootSpecifier?.sourceName ?? resolved.name);
        const declarationRelative = path
          .relative(repoRoot, declarationFile)
          .split(path.sep)
          .join("/");

        return {
          entrypoint,
          name: symbol.name,
          publicSourceName,
          typeOnly,
          directSource,
          declarationFile:
            isLocalV1Declaration(entrypoint, declarationFile) &&
            declarationRelative.startsWith("packages/")
              ? declarationRelative
              : null,
          replacement: hasReplacement
            ? {
                name: replacementName,
                importPath: entrypoint.v2ImportPath,
                source: replacementSource,
                docs,
                importLine: example.importLine,
                usageLine: example.usageLine,
                exampleLines: example.lines,
                notes: override?.notes ?? [],
              }
            : null,
          docs,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    inventories.push({ entrypoint, exports });
  }

  return { program, checker, inventories };
}

export function renderDeprecationJsDoc(item) {
  const { entrypoint } = item;
  const lines = [
    "/**",
    ` * @deprecated Since ${entrypoint.version}. The v1 SDK is deprecated. Use v2 instead.`,
  ];
  if (item.replacement) {
    lines.push(
      ` * Use \`${item.replacement.name}\` from \`${item.replacement.importPath}\` instead.`,
      " * Import and usage example:",
      " * ```ts",
      ...item.replacement.exampleLines
        .filter((line) => line.length > 0)
        .map((line) => ` * ${line}`),
      " * ```",
      ` * See ${item.replacement.docs}`,
    );
  } else {
    lines.push(
      " * No 1:1 v2 replacement is available.",
      ` * Start with \`${entrypoint.v2ImportPath}\` and the v2 reference: ${V2_REFERENCE}`,
    );
  }
  lines.push(` * Migration guide: ${MIGRATION_GUIDE}`, " */");
  return lines.join("\n");
}
