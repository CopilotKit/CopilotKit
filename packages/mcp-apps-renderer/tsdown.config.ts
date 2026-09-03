import { defineConfig } from "tsdown";

const externalPkgs = [
  "@modelcontextprotocol/ext-apps",
  "@modelcontextprotocol/sdk",
  "@ag-ui/client",
  "@copilotkit/shared",
  "zod",
  "lit",
];

const isExternal = (id: string) =>
  externalPkgs.some((pkg) => id === pkg || id.startsWith(pkg + "/"));

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    unbundle: true,
    external: isExternal,
    exports: false,
  },
  {
    entry: ["src/web-components/index.ts", "src/web-components/define.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist/web-components",
    unbundle: true,
    external: isExternal,
    exports: false,
  },
]);
