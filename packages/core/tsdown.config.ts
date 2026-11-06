import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      styles: "src/styles/index.ts",
      // The chat configuration store alone, without the rest of core, so an
      // Angular app can provide a chat configuration in its initial bundle.
      "chat-configuration": "src/chat/chat-configuration.ts",
      "generative-ui/index": "src/generative-ui/index.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    external: ["rxjs"],
    checks: { pluginTimings: false },
    exports: {
      customExports: (exports) => ({
        ...exports,
        "./styles.css": "./dist/styles.css",
      }),
    },
  },
  {
    entry: ["src/index.ts"],
    format: ["umd"],
    globalName: "CopilotKitCore",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: [
      "@copilotkit/shared",
      "@ag-ui/client",
      "@ag-ui/core",
      "rxjs",
      "zod",
      "@a2ui/web_core",
      "@a2ui/web_core/v0_9",
    ],
    // Bundle websandbox so its dynamic import is inlined: a UMD script cannot
    // `import()` a bare specifier, and the ES2018 target has no `import()`.
    noExternal: ["@jetbrains/websandbox"],
    inlineOnly: ["@jetbrains/websandbox"],
    codeSplitting: false,
    checks: { pluginTimings: false },
    outputOptions(options) {
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        "@copilotkit/shared": "CopilotKitShared",
        "@ag-ui/client": "AgUIClient",
        "@ag-ui/core": "AgUICore",
        rxjs: "rxjs",
        "rxjs/operators": "rxjs.operators",
        zod: "Zod",
        "@a2ui/web_core": "A2UIWebCore",
        "@a2ui/web_core/v0_9": "A2UIWebCoreV09",
      };
      return options;
    },
  },
]);
