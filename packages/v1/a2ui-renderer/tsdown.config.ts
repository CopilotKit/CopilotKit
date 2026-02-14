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
      const externalPkgs = [
        "react",
        "react-dom",
        "@copilotkit/react-core",
        "@copilotkitnext/react",
        "@a2ui/lit",
        "zod",
      ];
      return externalPkgs.some((pkg) => id === pkg || id.startsWith(pkg + "/"));
    },
    exports: true,
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitA2UIRenderer",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: (id) => {
      const externalPkgs = [
        "react",
        "react-dom",
        "@copilotkit/react-core",
        "@copilotkitnext/react",
        "@a2ui/lit",
        "zod",
      ];
      return externalPkgs.some((pkg) => id === pkg || id.startsWith(pkg + "/"));
    },
    codeSplitting: false,
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        react: "React",
        "react/jsx-runtime": "React",
        "react-dom": "ReactDOM",
        "@copilotkit/react-core": "CopilotKitReactCore",
        "@copilotkit/react-core/v2": "CopilotKitReactCore",
        "@copilotkitnext/react": "CopilotKitNextReact",
        "@a2ui/lit": "A2UILit",
        "@a2ui/lit/0.8": "A2UILit",
        zod: "Zod",
        clsx: "clsx",
        "markdown-it": "markdownit",
      };
      return options;
    },
  },
]);
