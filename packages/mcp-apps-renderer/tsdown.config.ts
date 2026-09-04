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
  {
    entry: ["src/index.ts", "src/activity.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    unbundle: true,
    external: isExternal,
    exports: false,
  },
]);
