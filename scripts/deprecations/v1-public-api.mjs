import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export const MIGRATION_GUIDE = "https://docs.copilotkit.ai/migrate/v2";
export const V2_DOCS = "https://docs.copilotkit.ai/";
export const V2_REFERENCE = "https://docs.copilotkit.ai/reference/v2";

// Every published v2 module a replacement may legitimately live in, most
// general first. The lookup below walks these in order and stops at the first
// module that exports the name, so the root barrel — the import path the docs
// teach — wins whenever it carries the symbol, and a narrower subpath is only
// named when it is the sole home.
//
// Before PE-123 this was a single `v2File`, and five of the nine entrypoints
// set it to `null`. For those the lookup could not run at all, so their rows
// reported "no replacement" by construction rather than by looking. Listing the
// modules per entrypoint makes every row a real answer.
const runtimeV2Modules = [
  {
    file: "packages/runtime/src/index.ts",
    importPath: "@copilotkit/runtime",
  },
  {
    file: "packages/runtime/src/node.ts",
    importPath: "@copilotkit/runtime/node",
  },
  {
    file: "packages/runtime/src/express.ts",
    importPath: "@copilotkit/runtime/express",
  },
  {
    file: "packages/runtime/src/hono.ts",
    importPath: "@copilotkit/runtime/hono",
  },
];

// `@copilotkit/sdk-js/langgraph` is the supported agent SDK for LangGraph
// TypeScript. It has no v2 counterpart, like the Python `copilotkit.langgraph`
// module. The deprecated `/langchain` entrypoint re-exports these files, so a
// file-level notice must not land on them.
export const supportedEntrypoints = [
  {
    importPath: "@copilotkit/sdk-js/langgraph",
    sourceRoot: "packages/sdk-js/src/langgraph/",
  },
];

export const v1Entrypoints = [
  {
    id: "sdk-js",
    file: "packages/sdk-js/src/index.ts",
    packageRoot: "packages/sdk-js",
    importPath: "@copilotkit/sdk-js",
    v2Modules: runtimeV2Modules,
    v2ImportPath: "@copilotkit/runtime",
    v2Source: "packages/runtime/src/index.ts",
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
    v2Modules: runtimeV2Modules,
    v2ImportPath: "@copilotkit/runtime",
    v2Source: "packages/runtime/src/index.ts",
    docsKind: "runtime",
    version: "1.68.2",
    distFiles: [
      "packages/sdk-js/dist/langchain.d.mts",
      "packages/sdk-js/dist/langchain.d.cts",
    ],
  },
  {
    id: "sdk-js-langgraph-middlewares",
    file: "packages/sdk-js/src/langgraph-middlewares.ts",
    packageRoot: "packages/sdk-js",
    importPath: "@copilotkit/sdk-js/langgraph-middlewares",
    v2Modules: runtimeV2Modules,
    v2ImportPath: "@copilotkit/runtime",
    v2Source: "packages/runtime/src/index.ts",
    docsKind: "runtime",
    version: "1.68.2",
    forcedDirectSource: "@ag-ui/langgraph/middlewares",
    distFiles: [
      "packages/sdk-js/dist/langgraph-middlewares.d.mts",
      "packages/sdk-js/dist/langgraph-middlewares.d.cts",
    ],
  },
];

const overrides = new Map();

const relatedConcepts = {
  agentContext: {
    label: "Agent context",
    url: "https://docs.copilotkit.ai/agent-app-context",
  },
  chat: {
    label: "Chat UI",
    url: "https://docs.copilotkit.ai/prebuilt-components/chat",
  },
  humanInTheLoop: {
    label: "Human-in-the-loop",
    url: "https://docs.copilotkit.ai/human-in-the-loop",
  },
  langGraph: {
    label: "LangGraph agents",
    url: "https://docs.copilotkit.ai/agent-spec/langgraph",
  },
  mcp: {
    label: "Model Context Protocol",
    url: "https://docs.copilotkit.ai/agentic-protocols/mcp",
  },
  provider: {
    label: "CopilotKit provider",
    url: "https://docs.copilotkit.ai/reference/v2/components/CopilotKit",
  },
  runtime: {
    label: "Runtime server adapter",
    url: "https://docs.copilotkit.ai/runtime-server-adapter",
  },
  stateRendering: {
    label: "State rendering",
    url: "https://docs.copilotkit.ai/generative-ui/state-rendering",
  },
  suggestions: {
    label: "Chat suggestions",
    url: "https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions",
  },
  threads: {
    label: "Conversation threads",
    url: "https://docs.copilotkit.ai/prebuilt-components/copilot-threads-drawer",
  },
  toolBasedUi: {
    label: "Tool-based generative UI",
    url: "https://docs.copilotkit.ai/generative-ui/tool-based",
  },
  toolRendering: {
    label: "Tool rendering",
    url: "https://docs.copilotkit.ai/generative-ui/tool-rendering",
  },
};

function addRelatedConcept(entrypointId, names, relatedDocs) {
  for (const name of names) {
    const key = `${entrypointId}:${name}`;
    overrides.set(key, { ...overrides.get(key), relatedDocs });
  }
}

const sdkLangGraphMigrationExports = [
  "convertActionsToDynamicStructuredTools",
  "convertActionToDynamicStructuredTool",
  "copilotKitCustomizeConfig",
  "copilotkitCustomizeConfig",
  "copilotKitEmitMessage",
  "copilotkitEmitMessage",
  "copilotKitEmitState",
  "copilotkitEmitState",
  "copilotKitEmitToolCall",
  "copilotkitEmitToolCall",
  "copilotKitExit",
  "copilotkitExit",
  "copilotKitInterrupt",
  "copilotkitMiddleware",
  "CopilotKitProperties",
  "CopilotKitPropertiesAnnotation",
  "CopilotKitPropertiesSchema",
  "CopilotKitSchemaState",
  "CopilotKitSchemaUpdate",
  "CopilotKitState",
  "CopilotKitStateAnnotation",
  "CopilotKitStateSchema",
  "createCopilotkitMiddleware",
  "ExposeStateOption",
  "IntermediateStateConfig",
  "OptionsConfig",
  "StandardSerializableSchema",
  "zodState",
];
addRelatedConcept(
  "sdk-js-langchain",
  sdkLangGraphMigrationExports,
  relatedConcepts.langGraph,
);
addRelatedConcept(
  "sdk-js-langgraph-middlewares",
  ["stateItem", "StateItem", "stateStreamingMiddleware"],
  relatedConcepts.langGraph,
);

// Keep the deprecated entrypoints wired through their historical local
// compatibility modules. The replacement still points to v2, but routing the
// v1 export itself through v2 (or directly through a dependency) changes the
// generated declaration graph and can alter runtime side effects.
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
    ...v1Entrypoints.flatMap(({ v2Modules }) =>
      v2Modules.map(({ file }) => path.join(repoRoot, file)),
    ),
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
    // Walk the entrypoint's v2 modules most-general first and keep the first
    // module that exports each name, recording which import path it came from.
    // A later module never displaces an earlier one, so the root barrel stays
    // the import path a row names whenever it carries the symbol.
    const targetByName = new Map();
    for (const v2Module of entrypoint.v2Modules) {
      const moduleSource = program.getSourceFile(
        path.join(repoRoot, v2Module.file),
      );
      if (!moduleSource?.symbol) {
        throw new Error(
          `Unable to load v2 module ${v2Module.file} for ${entrypoint.importPath}`,
        );
      }
      for (const symbol of checker.getExportsOfModule(moduleSource.symbol)) {
        if (targetByName.has(symbol.name)) continue;
        targetByName.set(symbol.name, { symbol, v2Module });
      }
    }
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
        const override = overrides.get(`${entrypoint.id}:${symbol.name}`);
        const directSource =
          override?.directSource ??
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
        const replacementName = override?.replacementName ?? symbol.name;
        const targetEntry = targetByName.get(replacementName);
        const targetSymbol = targetEntry?.symbol ?? null;
        const hasReplacement = Boolean(targetSymbol);
        // A replacement can live on a narrower v2 subpath than the entrypoint's
        // root one, so a row names the module the lookup actually found it in.
        // An explicit override still wins, because a symbol can be reachable
        // from the root barrel and still be better imported from a subpath: the
        // Express handler is re-exported by `@copilotkit/runtime`, but the
        // docs import it from `@copilotkit/runtime/express`, the path that
        // does not pull the rest of the barrel in.
        const replacementImportPath =
          override?.importPath ??
          targetEntry?.v2Module.importPath ??
          entrypoint.v2ImportPath;
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
                replacementImportPath,
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
            declarationRelative.startsWith("packages/") &&
            !supportedEntrypoints.some(({ sourceRoot }) =>
              declarationRelative.startsWith(sourceRoot),
            )
              ? declarationRelative
              : null,
          replacement: hasReplacement
            ? {
                name: replacementName,
                importPath: replacementImportPath,
                // The v2 module the lookup actually found the name in, before
                // any `importPath` override. Lets a test tell "the root barrel
                // carries this" from "only this subpath carries this".
                resolvedFrom: targetEntry.v2Module.importPath,
                source: replacementSource,
                docs,
                importLine: example.importLine,
                usageLine: example.usageLine,
                exampleLines: example.lines,
                notes: override?.notes ?? [],
              }
            : null,
          relatedDocs: hasReplacement ? null : (override?.relatedDocs ?? null),
          replacementNote: hasReplacement
            ? null
            : (override?.replacementNote ?? null),
          replacementNoteSource: hasReplacement
            ? null
            : (override?.replacementNoteSource ?? null),
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
    );
    if (item.replacement.docs === V2_REFERENCE) {
      lines.push(
        ` * V2 docs: ${V2_DOCS}`,
        ` * V2 reference docs: ${V2_REFERENCE}`,
      );
    } else {
      lines.push(` * See ${item.replacement.docs}`);
    }
  } else {
    if (item.replacementNote) {
      for (const note of item.replacementNote) lines.push(` * ${note}`);
    } else {
      lines.push(" * No 1:1 v2 replacement is available.");
    }
    if (item.relatedDocs) {
      lines.push(
        ` * Related v2 docs (${item.relatedDocs.label}): ${item.relatedDocs.url}`,
      );
    }
    lines.push(
      ` * Start with \`${entrypoint.v2ImportPath}\`.`,
      ` * V2 docs: ${V2_DOCS}`,
      ` * V2 reference docs: ${V2_REFERENCE}`,
    );
  }
  lines.push(` * Migration guide: ${MIGRATION_GUIDE}`, " */");
  return lines.join("\n");
}
