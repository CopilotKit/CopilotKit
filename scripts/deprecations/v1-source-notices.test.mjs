import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import {
  getV1PublicApi,
  MIGRATION_GUIDE,
  renderDeprecationJsDoc,
  repoRoot,
  V2_DOCS,
  V2_REFERENCE,
  v1Entrypoints,
} from "./v1-public-api.mjs";

const expectedCounts = new Map([
  ["react-core", 78],
  ["react-ui", 38],
  ["react-textarea", 14],
  ["runtime", 66],
  ["runtime-langgraph", 6],
  ["sdk-js", 2],
  ["sdk-js-langchain", 15],
  ["sdk-js-langgraph", 23],
  ["sdk-js-langgraph-middlewares", 3],
]);

function tagText(tag) {
  if (typeof tag.text === "string") return tag.text;
  return tag.text?.map((part) => part.text).join("") ?? "";
}

function deprecatedText(symbol, checker) {
  const tag = symbol
    .getJsDocTags(checker)
    .find((candidate) => candidate.name === "deprecated");
  return tag ? tagText(tag) : null;
}

const inventory = getV1PublicApi();
const STATE_RENDERING_DOCS =
  "https://docs.copilotkit.ai/generative-ui/state-rendering";

test("dual-version packages keep v1 internal and expose only root compatibility plus v2", () => {
  for (const { packageRoot, rootDirective = "" } of [
    {
      packageRoot: "packages/react-core",
      rootDirective: '"use client";\n\n',
    },
    { packageRoot: "packages/runtime" },
  ]) {
    const sourceRoot = path.join(repoRoot, packageRoot, "src");
    for (const required of [
      "index.ts",
      "v1-deprecated-compatibility.ts",
      "v1-deprecated/index.ts",
      "v2/index.ts",
    ]) {
      assert.ok(
        existsSync(path.join(sourceRoot, required)),
        `${packageRoot}/src/${required} must exist`,
      );
    }

    const rootSource = readFileSync(path.join(sourceRoot, "index.ts"), "utf8");
    const executableRootSource = rootSource.replace(/\/\*[\s\S]*?\*\/\s*/g, "");
    assert.equal(
      executableRootSource,
      `${rootDirective}export * from "./v1-deprecated-compatibility";\n`,
      `${packageRoot}/src/index.ts must remain a thin compatibility shim`,
    );

    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, packageRoot, "package.json"), "utf8"),
    );
    const publicSubpaths = Object.keys(packageJson.exports ?? {});
    assert.ok(publicSubpaths.includes("."));
    assert.ok(publicSubpaths.includes("./v2"));
    assert.equal(
      publicSubpaths.some(
        (subpath) =>
          subpath === "./v1" ||
          subpath.startsWith("./v1/") ||
          subpath === "./v1-deprecated" ||
          subpath.startsWith("./v1-deprecated/"),
      ),
      false,
      `${packageRoot} must not publish a deprecated implementation entrypoint`,
    );
  }
});

test("version-neutral React Core contracts stay outside v1-deprecated", () => {
  const neutralContract = path.join(
    repoRoot,
    "packages/react-core/src/__tests__/threadid-propagation.contract.test.tsx",
  );
  const deprecatedContract = path.join(
    repoRoot,
    "packages/react-core/src/v1-deprecated/__tests__/threadid-propagation.contract.test.tsx",
  );

  assert.ok(
    existsSync(neutralContract),
    "the v2 threadId propagation contract must remain at the neutral package boundary",
  );
  assert.equal(
    existsSync(deprecatedContract),
    false,
    "the v2 threadId propagation contract must not be classified as deprecated v1 coverage",
  );
});

test("inventory covers every public v1 package entrypoint", () => {
  const configured = new Set(
    v1Entrypoints.map((entrypoint) => entrypoint.importPath),
  );
  const discovered = new Set();
  const packageRoots = new Set(
    v1Entrypoints.map((entrypoint) => entrypoint.packageRoot),
  );

  for (const packageRoot of packageRoots) {
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, packageRoot, "package.json"), "utf8"),
    );
    const packageExports = packageJson.exports ?? { ".": packageJson.main };

    for (const [subpath, target] of Object.entries(packageExports)) {
      if (
        subpath === "./package.json" ||
        subpath === "./v2" ||
        subpath.startsWith("./v2/") ||
        subpath.endsWith("styles.css") ||
        (typeof target === "string" && target.endsWith(".css"))
      ) {
        continue;
      }

      discovered.add(
        subpath === "."
          ? packageJson.name
          : `${packageJson.name}/${subpath.slice(2)}`,
      );
    }
  }

  assert.deepEqual([...configured].sort(), [...discovered].sort());
});

test("inventory covers every configured v1 importable export", () => {
  let total = 0;
  for (const { entrypoint, exports } of inventory.inventories) {
    assert.equal(
      exports.length,
      expectedCounts.get(entrypoint.id),
      `${entrypoint.importPath} public export count changed; regenerate and audit its mappings`,
    );
    assert.equal(
      new Set(exports.map((item) => item.name)).size,
      exports.length,
    );
    total += exports.length;
  }
  assert.equal(total, 245);
});

test("every v1 importable export has an IDE-visible use-v2 deprecation", () => {
  const failures = [];
  for (const { entrypoint, exports } of inventory.inventories) {
    const sourceFile = inventory.program.getSourceFile(
      path.join(repoRoot, entrypoint.file),
    );
    const symbols = new Map(
      inventory.checker
        .getExportsOfModule(sourceFile.symbol)
        .map((symbol) => [symbol.name, symbol]),
    );
    for (const item of exports) {
      const warning = deprecatedText(symbols.get(item.name), inventory.checker);
      if (!warning) {
        failures.push(
          `${entrypoint.importPath}:${item.name} has no @deprecated tag`,
        );
        continue;
      }
      for (const required of [
        `Since ${entrypoint.version}`,
        "The v1 SDK is deprecated. Use v2 instead.",
        MIGRATION_GUIDE,
      ]) {
        if (!warning.includes(required)) {
          failures.push(
            `${entrypoint.importPath}:${item.name} is missing ${required}`,
          );
        }
      }
      if (item.replacement) {
        for (const required of [
          "Import and usage example:",
          item.replacement.name,
          item.replacement.importPath,
          item.replacement.importLine,
          item.replacement.usageLine.trim(),
          item.replacement.docs,
        ]) {
          if (!warning.includes(required)) {
            failures.push(
              `${entrypoint.importPath}:${item.name} is missing ${required}`,
            );
          }
        }
      } else if (
        !warning.includes("No 1:1 v2 replacement is available") ||
        !warning.includes(`V2 docs: ${V2_DOCS}`) ||
        !warning.includes(`V2 reference docs: ${V2_REFERENCE}`)
      ) {
        failures.push(
          `${entrypoint.importPath}:${item.name} needs no-replacement v2 guidance`,
        );
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("generated entrypoint blocks contain the complete warning text", () => {
  for (const { entrypoint, exports } of inventory.inventories) {
    const source = readFileSync(path.join(repoRoot, entrypoint.file), "utf8");
    assert.ok(source.startsWith("/*\n * V1 SDK DEPRECATED. USE V2 INSTEAD"));
    assert.match(source, /AI CODING AGENTS:/);
    assert.match(source, /START GENERATED V1 DEPRECATED EXPORTS/);
    for (const item of exports) {
      const indentedWarning = renderDeprecationJsDoc(item)
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n");
      assert.ok(
        source.includes(indentedWarning),
        `${entrypoint.file} is stale for ${item.name}`,
      );
    }
  }
});

test("every local public v1 source file has exact per-export guidance", () => {
  const byFile = new Map();
  for (const { exports } of inventory.inventories) {
    for (const item of exports) {
      if (!item.declarationFile) continue;
      const group = byFile.get(item.declarationFile) ?? [];
      group.push(item);
      byFile.set(item.declarationFile, group);
    }
  }
  for (const [file, items] of byFile) {
    if (
      inventory.inventories.some(({ entrypoint }) => entrypoint.file === file)
    ) {
      continue;
    }
    const source = readFileSync(path.join(repoRoot, file), "utf8");
    assert.ok(source.startsWith("/*\n * V1 SDK DEPRECATED. USE V2 INSTEAD"));
    assert.match(source, /AI CODING AGENTS:/);
    assert.doesNotMatch(source, /V1 source file:/);
    for (const item of items) {
      assert.ok(
        source.includes(`${item.entrypoint.importPath} — ${item.name}:`),
      );
      if (item.replacement) {
        assert.ok(source.includes("V2 import and usage:"));
        for (const line of item.replacement.exampleLines.filter(Boolean)) {
          assert.ok(source.includes(line));
        }
        assert.ok(source.includes(item.replacement.source));
        assert.ok(source.includes(item.replacement.docs));
      } else {
        assert.ok(source.includes("No 1:1 v2 replacement is available."));
        assert.ok(source.includes(item.entrypoint.v2ImportPath));
        assert.ok(source.includes(`V2 docs: ${V2_DOCS}`));
        assert.ok(source.includes(`V2 reference docs: ${V2_REFERENCE}`));
        if (item.relatedDocs) {
          assert.ok(
            source.includes(
              `Related v2 docs (${item.relatedDocs.label}): ${item.relatedDocs.url}`,
            ),
          );
        }
      }
    }
  }
});

test("v1 deprecation aliases do not poison v2 exports", () => {
  const checked = new Set();
  const failures = [];
  for (const { entrypoint, exports } of inventory.inventories) {
    if (!entrypoint.v2File) continue;
    const target = inventory.program.getSourceFile(
      path.join(repoRoot, entrypoint.v2File),
    );
    const targetSymbols = new Map(
      inventory.checker
        .getExportsOfModule(target.symbol)
        .map((symbol) => [symbol.name, symbol]),
    );
    for (const item of exports) {
      if (!item.replacement) continue;
      const key = `${entrypoint.v2File}:${item.replacement.name}`;
      if (checked.has(key)) continue;
      checked.add(key);
      const warning = deprecatedText(
        targetSymbols.get(item.replacement.name),
        inventory.checker,
      );
      if (warning?.includes("The v1 SDK is deprecated. Use v2 instead.")) {
        failures.push(key);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("semantic migrations use curated replacements instead of same-name guesses", () => {
  const mappings = new Map(
    inventory.inventories.flatMap(({ entrypoint, exports }) =>
      exports.map((item) => [
        `${entrypoint.id}:${item.name}`,
        item.replacement?.name ?? null,
      ]),
    ),
  );
  assert.equal(mappings.get("react-core:useRenderToolCall"), "useRenderTool");
  assert.equal(mappings.get("react-core:useCopilotAction"), "useFrontendTool");
  assert.equal(
    mappings.get("react-core:useCopilotReadable"),
    "useAgentContext",
  );
  assert.equal(mappings.get("react-core:useCoAgent"), "useAgent");
  assert.equal(mappings.get("react-core:useCoAgentStateRender"), "useAgent");
  assert.equal(
    mappings.get("react-core:useDefaultTool"),
    "useDefaultRenderTool",
  );
});

test("useCoAgentStateRender points to the v2 state-rendering pattern", () => {
  const item = inventory.inventories
    .find(({ entrypoint }) => entrypoint.id === "react-core")
    ?.exports.find(({ name }) => name === "useCoAgentStateRender");

  assert.equal(item?.replacement?.name, "useAgent");
  assert.equal(item.replacement.docs, STATE_RENDERING_DOCS);
  assert.ok(
    item.replacement.exampleLines.includes(
      'import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";',
    ),
  );
  assert.ok(
    item.replacement.exampleLines.includes(
      "    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],",
    ),
  );
  assert.ok(
    item.replacement.exampleLines.includes("  const state = agent.state;"),
  );
});

test("related v2 concepts guide state-rendering APIs without inventing replacements", () => {
  const relatedStateRenderingExports = new Set([
    "CoagentInChatRenderFunction",
    "CoAgentStateRendersContext",
    "CoAgentStateRendersContextValue",
    "CoAgentStateRendersProvider",
    "useCoAgentStateRenders",
  ]);
  const exports = inventory.inventories.find(
    ({ entrypoint }) => entrypoint.id === "react-core",
  ).exports;

  for (const name of relatedStateRenderingExports) {
    const item = exports.find((candidate) => candidate.name === name);
    assert.equal(item?.replacement, null);
    assert.deepEqual(item?.relatedDocs, {
      label: "State rendering",
      url: STATE_RENDERING_DOCS,
    });
    assert.ok(
      renderDeprecationJsDoc(item).includes(
        `Related v2 docs (State rendering): ${STATE_RENDERING_DOCS}`,
      ),
    );
  }
});

test("related v2 concepts cover other clear migration families", () => {
  const expected = new Map([
    [
      "react-core:FrontendAction",
      {
        label: "Tool-based generative UI",
        url: "https://docs.copilotkit.ai/generative-ui/tool-based",
      },
    ],
    [
      "react-core:LangGraphInterruptRender",
      {
        label: "Human-in-the-loop",
        url: "https://docs.copilotkit.ai/human-in-the-loop",
      },
    ],
    [
      "react-ui:AssistantMessageProps",
      {
        label: "Chat UI",
        url: "https://docs.copilotkit.ai/prebuilt-components/chat",
      },
    ],
    [
      "runtime:OpenAIAdapter",
      {
        label: "Runtime server adapter",
        url: "https://docs.copilotkit.ai/runtime-server-adapter",
      },
    ],
    [
      "runtime:MCPTool",
      {
        label: "Model Context Protocol",
        url: "https://docs.copilotkit.ai/agentic-protocols/mcp",
      },
    ],
    [
      "sdk-js-langgraph:copilotkitMiddleware",
      {
        label: "LangGraph agents",
        url: "https://docs.copilotkit.ai/agent-spec/langgraph",
      },
    ],
  ]);
  const actual = new Map(
    inventory.inventories.flatMap(({ entrypoint, exports }) =>
      exports.map((item) => [
        `${entrypoint.id}:${item.name}`,
        item.relatedDocs,
      ]),
    ),
  );

  for (const [key, relatedDocs] of expected) {
    assert.deepEqual(actual.get(key), relatedDocs, key);
  }
});

test("the generic v2 reference is never mislabeled as the v2 docs homepage", () => {
  const staleLabel = `V2 docs: ${V2_REFERENCE}`;

  for (const { entrypoint, exports } of inventory.inventories) {
    const entrypointSource = readFileSync(
      path.join(repoRoot, entrypoint.file),
      "utf8",
    );
    assert.ok(
      !entrypointSource.includes(staleLabel),
      `${entrypoint.file} still contains ${staleLabel}`,
    );

    for (const item of exports) {
      const warning = renderDeprecationJsDoc(item);
      assert.ok(
        !warning.includes(staleLabel),
        `${entrypoint.importPath}:${item.name} still contains ${staleLabel}`,
      );
      if (item.replacement?.docs === V2_REFERENCE) {
        assert.ok(warning.includes(`V2 docs: ${V2_DOCS}`));
        assert.ok(warning.includes(`V2 reference docs: ${V2_REFERENCE}`));
      }
    }
  }
});

test("the agent-readable docs map contains all 245 v1 exports", () => {
  const source = readFileSync(
    path.join(
      repoRoot,
      "showcase/shell-docs/src/content/reference/v1/export-map.mdx",
    ),
    "utf8",
  );
  assert.match(source, /complete v1 to v2 export map/i);
  assert.ok(source.includes(MIGRATION_GUIDE));
  assert.equal(V2_DOCS, "https://docs.copilotkit.ai/");
  assert.ok(source.includes(`[V2 docs](${V2_DOCS})`));
  assert.ok(source.includes(`[V2 reference docs](${V2_REFERENCE})`));
  assert.ok(source.includes(`[State rendering](${STATE_RENDERING_DOCS})`));
  let rows = 0;
  for (const { entrypoint, exports } of inventory.inventories) {
    assert.ok(source.includes(`## \`${entrypoint.importPath}\``));
    for (const item of exports) {
      const escapedName = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(
        source,
        new RegExp("^\\| `" + escapedName + "`\\s+\\|", "m"),
      );
      rows += 1;
    }
  }
  assert.equal(rows, 245);
});
