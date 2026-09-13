import { defineConfig } from "tsdown";

const externalPkgs = [
  "@modelcontextprotocol/ext-apps",
  "@modelcontextprotocol/sdk",
  "@ag-ui/client",
  "@copilotkit/shared",
  "zod",
];

const isExternal = (id: string) =>
  externalPkgs.some((pkg) => id === pkg || id.startsWith(pkg + "/"));

export default defineConfig([
  // Root entry: ESM only. It re-exports the session, which imports the ext-apps
  // AppBridge - and ext-apps 1.7.5 is ESM-only. A CJS root would emit a
  // `require()` of that ESM module and fail with ERR_REQUIRE_ESM, so we do not
  // advertise a CJS root. Consumers load the bridge via a dynamic `import()`
  // (react-core does), which resolves ESM from any context.
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    unbundle: true,
    external: isExternal,
    exports: false,
  },
  // Activity entry: the bridge-free registration surface (activity type, content
  // schema, follow-up runner). It has no ext-apps edge, so it is safe as dual
  // ESM + CJS - frontends register the activity synchronously from either module
  // system without pulling the bridge.
  {
    entry: ["src/activity.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    unbundle: true,
    external: isExternal,
    exports: false,
  },
  // Activity UMD: a self-contained global for script-tag consumers of
  // @copilotkit/react-core's UMD build, which externalizes this entry and maps
  // it to `CopilotKitMcpAppsRendererActivity`. Bridge-free, so only zod is
  // external (mapped to the shared `Zod` global, matching react-core's UMD).
  {
    entry: ["src/activity.ts"],
    format: ["umd"],
    globalName: "CopilotKitMcpAppsRendererActivity",
    sourcemap: true,
    // es2018 for the script-tag UMD (broad browser reach), matching a2ui-renderer.
    target: "es2018",
    outDir: "dist",
    external: (id: string) => id === "zod" || id.startsWith("zod/"),
    // Force a single self-contained bundle (matches a2ui-renderer): without this,
    // a sibling chunk emitted next to activity.umd.js would leave the global
    // incomplete, and es-check (syntax-only) would not catch it.
    codeSplitting: false,
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = { zod: "Zod" };
      return options;
    },
  },
]);
