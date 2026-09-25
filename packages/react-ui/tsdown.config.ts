/// <reference types="node" />
import { defineConfig } from "tsdown";
import fs from "fs";
import path from "path";

// Side-effect CSS imports are kept in the JS output so styles auto-load for
// bundler consumers, but rolldown-plugin-dts also leaves them in the emitted
// declaration files, where TypeScript cannot resolve a `.css` as a typed module
// (an `attw` InternalResolutionError). Strip them from declarations only, via the
// `build:done` hook so every format's declarations are post-processed on disk.
const stripCssTypeImports = (dir: string) => {
  const cssImport = /^[ \t]*import\s+["'][^"']+\.css["'];?[ \t]*\r?\n/gm;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.d\.[cm]?ts$/.test(entry.name)) {
        const code = fs.readFileSync(full, "utf8");
        const next = code.replace(cssImport, "");
        if (next !== code) fs.writeFileSync(full, next);
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
};

export default defineConfig([
  {
    entry: ["src/index.tsx"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    hooks: {
      "build:done": () => stripCssTypeImports(path.resolve("dist")),
    },
    external: [
      "react",
      "react-dom",
      "@copilotkit/core",
      "@copilotkit/react-core/v2",
    ],
    exports: {
      customExports: (exports) => ({
        ...exports,
        "./styles.css": "./dist/index.css",
        "./v2/styles.css": "./dist/v2/index.css",
      }),
    },
  },
  {
    entry: ["src/index.tsx"],
    format: ["umd"],
    globalName: "CopilotKitReactUI",
    sourcemap: true,
    target: "es2018",
    outDir: "dist",
    external: [
      "react",
      "react-dom",
      "@copilotkit/react-core",
      "@copilotkit/shared",
      "@copilotkit/runtime-client-gql",
    ],
    plugins: [
      {
        name: "umd-lazy-syntax-highlighter",
        renderChunk(code) {
          // Native import() exceeds the ES2018 UMD target. Resolve the same
          // external only when a code block mounts, from CommonJS or its global.
          const highlighterImport =
            /import\(["']react-syntax-highlighter["']\)/g;
          if (code.match(highlighterImport)?.length !== 1) {
            throw new Error(
              "Expected one lazy syntax highlighter import in the UMD bundle",
            );
          }
          const deferredHighlighter = [
            "Promise.resolve().then(() =>",
            'typeof define === "function" && define.amd && typeof require === "function"',
            '? new Promise((resolve, reject) => require(["react-syntax-highlighter"], resolve, reject))',
            ': typeof require === "function" ? require("react-syntax-highlighter")',
            ': typeof globalThis !== "undefined" ? globalThis.ReactSyntaxHighlighter',
            ': typeof window !== "undefined" ? window.ReactSyntaxHighlighter : undefined)',
          ].join(" ");
          const output = code.replace(highlighterImport, deferredHighlighter);
          if (/\bimport\s*\(/.test(output)) {
            throw new Error(
              "UMD output still contains an unsupported dynamic import",
            );
          }
          return output;
        },
      },
    ],
    outputOptions(options) {
      options.codeSplitting = false;
      options.entryFileNames = "[name].umd.js";
      options.globals = {
        react: "React",
        "react-dom": "ReactDOM",
        "react/jsx-runtime": "ReactJsxRuntime",
        "@copilotkit/react-core": "CopilotKitReactCore",
        "@copilotkit/shared": "CopilotKitShared",
        "@copilotkit/runtime-client-gql": "CopilotKitRuntimeClientGQL",
        "@headlessui/react": "HeadlessUIReact",
        "react-markdown": "ReactMarkdown",
        "react-syntax-highlighter": "ReactSyntaxHighlighter",
        "remark-gfm": "remarkGfm",
        "remark-math": "remarkMath",
        "rehype-raw": "rehypeRaw",
      };
      return options;
    },
  },
]);
