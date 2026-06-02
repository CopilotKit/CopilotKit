import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/react/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    outDir: "dist",
    // react is a peer; @copilotkit/markdown-renderer is the root entry of this same
    // package — consumers always have it, so treat it as external in the /react bundle.
    external: ["react", "react/jsx-runtime", "react-dom", "@copilotkit/markdown-renderer"],
    exports: true,
  },
]);
