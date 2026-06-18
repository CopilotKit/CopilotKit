import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // Main is ESM, but Electron's sandboxed renderer requires a CommonJS
    // preload. Emit it as index.cjs (loaded by src/main/index.ts).
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.cjs",
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": fileURLToPath(
          new URL("./src/renderer/src", import.meta.url),
        ),
      },
    },
    plugins: [react()],
  },
});
