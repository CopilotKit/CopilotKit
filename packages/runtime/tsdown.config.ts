import { defineConfig } from "tsdown";
import fs from "node:fs";
import path from "node:path";
import { v2AliasExports } from "../../scripts/deprecations/v2-subpath-aliases.mts";

const { version } = JSON.parse(
  fs.readFileSync(path.resolve("package.json"), "utf8"),
) as { version: string };

export default defineConfig({
  entry: {
    index: "src/index.ts",
    node: "src/node.ts",
    agent: "src/agent/index.ts",
    "agent/ai-sdk": "src/agent/ai-sdk/index.ts",
    "internal/learned-skills": "src/internal/learned-skills.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  unbundle: true,
  // See src/runtime/core/package-info.ts for why the version is injected
  // rather than imported from package.json.
  define: {
    __COPILOTKIT_RUNTIME_VERSION__: JSON.stringify(version),
  },
  external: ["@whatwg-node/fetch", "@whatwg-node/server", "rxjs"],
  exports: {
    // The `/v2` subpaths of 1.x are deprecated aliases of the 2.0 entries:
    // the same files, with declarations that mark each name deprecated
    // (written after the build by scripts/deprecations/v2-subpath-aliases.mts).
    customExports: (exports) =>
      v2AliasExports(exports, {
        entries: { "./v2": ".", "./v2/node": "./node" },
        stylesheets: [],
      }),
  },
});
