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
    external: ["react", "react-dom"],
    exports: {
      customExports: (exports) => ({
        ...exports,
        "./styles.css": "./dist/index.css",
      }),
    },
  },
  {
    entry: ["src/index.tsx"],
    format: ["umd"],
    globalName: "CopilotKitReactTextarea",
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
        slate: "Slate",
        "slate-react": "SlateReact",
        "slate-history": "SlateHistory",
        "tailwind-merge": "tailwindMerge",
        clsx: "clsx",
        "@emotion/css": "emotionCss",
        cmdk: "cmdk",
        "@radix-ui/react-slot": "RadixReactSlot",
        "class-variance-authority": "classVarianceAuthority",
        "@radix-ui/react-label": "RadixReactLabel",
        "@mui/material/Chip/Chip.js": "MuiChip",
        "@mui/material/Avatar/Avatar.js": "MuiAvatar",
        "lodash.merge": "lodashMerge",
      };
      return options;
    },
  },
]);
