// @vitest-environment node
import { describe, expect, it } from "vitest";
import config from "../../vite.config";
import packageJson from "../../package.json";
import { useFrontendTool } from "../hooks/use-frontend-tool";
import { createGenerativeUI } from "../generative-ui";
import { GenerativeUIChart } from "../generative-ui-chart";
import { GenerativeUIMap } from "../generative-ui-map";

/** The library entries of vite.config.ts: path in dist to source file. */
function libraryEntries() {
  const lib = config.build?.lib;
  const entry = lib ? lib.entry : undefined;
  if (typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("vite.config.ts must name its library entries");
  }
  return entry;
}

const entries = libraryEntries();

/** Loads a build entry from the source file that vite.config.ts gives it. */
async function importEntry(name: string) {
  const file = entries[name];
  if (file === undefined) {
    throw new Error(`vite.config.ts has no "${name}" entry`);
  }
  return import(/* @vite-ignore */ file);
}

// Each code export of package.json, the build entry it ships, and one export
// that shows the entry builds from the right module. The root's
// useFrontendTool must be the 2.0 hook.
const packageExports = [
  { key: ".", entry: "index", name: "useFrontendTool", value: useFrontendTool },
  {
    key: "./generative-ui",
    entry: "generative-ui/index",
    name: "createGenerativeUI",
    value: createGenerativeUI,
  },
  {
    key: "./generative-ui/chart",
    entry: "generative-ui-chart/index",
    name: "GenerativeUIChart",
    value: GenerativeUIChart,
  },
  {
    key: "./generative-ui/map",
    entry: "generative-ui-map/index",
    name: "GenerativeUIMap",
    value: GenerativeUIMap,
  },
] as const;

// The `/v2` subpaths of 1.x, kept as deprecated aliases of the 2.0 entries:
// the JavaScript of the entry, and declarations of their own that mark each
// name deprecated (written by scripts/deprecations/v2-subpath-aliases.mts).
const v2Aliases = [
  { key: "./v2", entry: "index", types: "./dist/v2/index" },
  {
    key: "./v2/generative-ui",
    entry: "generative-ui/index",
    types: "./dist/v2/generative-ui",
  },
  {
    key: "./v2/generative-ui/chart",
    entry: "generative-ui-chart/index",
    types: "./dist/v2/generative-ui/chart",
  },
  {
    key: "./v2/generative-ui/map",
    entry: "generative-ui-map/index",
    types: "./dist/v2/generative-ui/map",
  },
] as const;

// Loading the root entry transforms the whole package from source, which can
// take longer than a test's timeout, so the entries load once, here.
const builtEntries = new Map(
  await Promise.all(
    packageExports.map(
      async ({ entry }) => [entry, await importEntry(entry)] as const,
    ),
  ),
);

describe("library build entries", () => {
  it("builds one entry for each code export of package.json", () => {
    expect(Object.keys(entries).sort()).toEqual(
      packageExports.map(({ entry }) => entry).sort(),
    );
    expect(Object.keys(packageJson.exports).sort()).toEqual(
      [
        ...packageExports.map(({ key }) => key),
        ...v2Aliases.map(({ key }) => key),
        "./package.json",
      ].sort(),
    );
  });

  it.each(v2Aliases)(
    "keeps $key as a deprecated alias of dist/$entry",
    ({ key, entry, types }) => {
      expect(packageJson.exports[key]).toEqual({
        import: { types: `${types}.d.mts`, default: `./dist/${entry}.mjs` },
        require: { types: `${types}.d.cts`, default: `./dist/${entry}.cjs` },
      });
    },
  );

  it.each(packageExports)(
    "ships $key from dist/$entry, with its types next to the JS",
    ({ key, entry }) => {
      expect(packageJson.exports[key]).toEqual({
        import: {
          types: `./dist/${entry}.d.mts`,
          default: `./dist/${entry}.mjs`,
        },
        require: {
          types: `./dist/${entry}.d.cts`,
          default: `./dist/${entry}.cjs`,
        },
      });
    },
  );

  it.each(packageExports)(
    "builds $key from the module that exports $name",
    ({ entry, name, value }) => {
      expect(builtEntries.get(entry)?.[name]).toBe(value);
    },
  );
});
