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
      const externalPkgs = ["react", "react-dom", "zod"];
      return externalPkgs.some((pkg) => id === pkg || id.startsWith(pkg + "/"));
    },
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
    external: (id) => {
      const externalPkgs = ["lit", "@a2ui/web_core", "zod"];
      return externalPkgs.some((pkg) => id === pkg || id.startsWith(pkg + "/"));
    },
    exports: false,
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitA2UIRenderer",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: (id) => {
      const externalPkgs = ["react", "react-dom", "zod"];
      return externalPkgs.some((pkg) => id === pkg || id.startsWith(pkg + "/"));
    },
    codeSplitting: false,
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        react: "React",
        "react/jsx-runtime": "React",
        "react-dom": "ReactDOM",
        zod: "Zod",
        clsx: "clsx",
        "markdown-it": "markdownit",
      };
      return options;
    },
  },
]);
