import { defineConfig } from "tsdown";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: {
    index: "src/index.ts",
    // Named subpath exports from package.json.
    "testing/state-store-conformance": "src/testing/state-store-conformance.ts",
    "render/takumi": "src/render/takumi.ts",
    "jsx-runtime": "src/jsx-runtime.ts",
    "jsx-dev-runtime": "src/jsx-dev-runtime.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  target: "es2022",
  outDir: "dist",
  unbundle: true,
  // Keep the same .js / .d.ts extensions as the previous tsc build so that the
  // package.json exports entries remain valid. The package is "type":"module",
  // so .js files are treated as ESM by Node.js and all consuming bundlers.
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  // Do not let tsdown rewrite the package.json exports — we manage them by hand
  // to preserve the types/import conditional-exports structure.
  exports: false,
  // Inject the package version without createRequire(import.meta.url) so the
  // built module is safe to load on Cloudflare Workers (#8539). The source
  // side of this is src/package-info.ts; the vitest side is vitest.config.ts.
  define: {
    __CHANNELS_CORE_PACKAGE_VERSION__: JSON.stringify(version),
  },
  esbuildOptions: {
    jsx: "automatic",
    jsxImportSource: "@copilotkit/channels-core",
  },
});
