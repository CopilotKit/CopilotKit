import { defineConfig } from "tsdown";
import fs from "node:fs";
import path from "node:path";

const { version } = JSON.parse(
  fs.readFileSync(path.resolve("package.json"), "utf8"),
) as { version: string };

export default defineConfig({
  entry: {
    index: "src/index.ts",
    express: "src/express.ts",
    hono: "src/hono.ts",
    node: "src/node.ts",
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
  exports: true,
});
