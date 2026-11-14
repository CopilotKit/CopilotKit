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
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitA2UIRenderer",
    // A <script>-tag page has no bundler to replace process.env.NODE_ENV and
    // usually no `process` global, so the UMD build fixes it to production.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
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
