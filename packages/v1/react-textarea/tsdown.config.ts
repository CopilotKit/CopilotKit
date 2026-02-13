import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.tsx"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
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
    codeSplitting: false,
    outputOptions(options) {
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
