// Loads the BUILT `/v2` subpaths through the `exports` map of the package,
// from ESM and from CommonJS, as 1.x code does. This file is inside the
// package, so `@copilotkit/runtime/...` resolves to this package. The type
// fixtures pass even when the map sends the JavaScript to a file without the
// 1.x names, so this checks the values:
//
// - each `/v2` subpath exports every export of its 2.0 entry, with the same
//   value, except the 1.x names that the alias defines itself. The entry can
//   export one of those names as the stand-in of a removed 1.x export, for
//   example the v1 `CopilotRuntime` class on the root;
// - each 1.x name is the value of its 2.0 name;
// - `/v2` exports the Built-in Agent values of `@copilotkit/runtime/agent`.
//
// Run by `pnpm --filter @copilotkit/runtime check-dts`, which depends on
// `build`.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Each `/v2` subpath, its 2.0 entry, and its 1.x values by their 2.0 names. */
const ALIASES = [
  {
    alias: "@copilotkit/runtime/v2",
    entry: "@copilotkit/runtime",
    renamed: {
      CopilotRuntime: "CopilotKitRuntime",
      CopilotSseRuntime: "CopilotKitSseRuntime",
      CopilotIntelligenceRuntime: "CopilotKitIntelligenceRuntime",
      createCopilotRuntimeHandler: "createCopilotKitRuntimeHandler",
    },
  },
  {
    alias: "@copilotkit/runtime/v2/node",
    entry: "@copilotkit/runtime/node",
    renamed: {
      createCopilotNodeListener: "createCopilotKitNodeListener",
      createCopilotNodeHandler: "createCopilotKitNodeHandler",
      createNodeFetchHandler: "createCopilotKitNodeHandler",
    },
  },
];

/** The Built-in Agent values that 1.x exported from `@copilotkit/runtime/v2`. */
const AGENT_VALUES = [
  "BuiltInAgent",
  "InterruptSignal",
  "convertAISDKStream",
  "convertInputToTanStackAI",
  "convertTanStackStream",
  "defineTool",
];

const FORMATS = {
  esm: (specifier) => import(specifier),
  cjs: (specifier) => require(specifier),
};

const SPECIFIERS = [
  ...new Set([
    ...ALIASES.flatMap(({ alias, entry }) => [alias, entry]),
    "@copilotkit/runtime/agent",
  ]),
];

// Load every module in both formats first; the checks below are synchronous.
const loaded = await Promise.all(
  Object.entries(FORMATS).flatMap(([format, load]) =>
    SPECIFIERS.map((specifier) =>
      Promise.resolve(load(specifier)).then((module) => ({
        format,
        specifier,
        module,
      })),
    ),
  ),
);

/** The loaded modules, by format, then by specifier. */
const MODULES = {};
for (const { format, specifier, module } of loaded) {
  MODULES[format] = { ...MODULES[format], [specifier]: module };
}

for (const [format, modules] of Object.entries(MODULES)) {
  for (const { alias, entry, renamed } of ALIASES) {
    const aliasModule = modules[alias];
    const entryModule = modules[entry];
    for (const [name, value] of Object.entries(entryModule)) {
      if (Object.hasOwn(renamed, name)) continue;
      assert.equal(
        aliasModule[name],
        value,
        `${alias} (${format}) exports ${name} of ${entry}`,
      );
    }
    for (const [oldName, newName] of Object.entries(renamed)) {
      assert.equal(typeof entryModule[newName], "function");
      assert.equal(
        aliasModule[oldName],
        entryModule[newName],
        `${alias} (${format}): ${oldName} is ${newName}`,
      );
    }
  }

  const v2 = modules["@copilotkit/runtime/v2"];
  const agent = modules["@copilotkit/runtime/agent"];
  for (const name of AGENT_VALUES) {
    assert.equal(typeof agent[name], "function");
    assert.equal(
      v2[name],
      agent[name],
      `@copilotkit/runtime/v2 (${format}) exports ${name} of @copilotkit/runtime/agent`,
    );
  }
}

console.log("The built /v2 subpaths export the 1.x names (ESM and CommonJS).");
