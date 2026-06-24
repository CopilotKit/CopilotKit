import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    unbundle: true,
    external: (id) => {
      const externalPkgs = ["lit"];
      return externalPkgs.some((pkg) => id === pkg || id.startsWith(pkg + "/"));
    },
    exports: false,
  },
]);
