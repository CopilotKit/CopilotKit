import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import dts from "vite-plugin-dts";
import { libInjectCss } from "vite-plugin-lib-inject-css";
import preserveDirectives from "rollup-preserve-directives";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), libInjectCss(), dts({ include: "src" }), preserveDirectives()],
  build: {
    outDir: "dist",
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "@copilotkit/shared",
        "@copilotkit/react-core",
      ],
      onLog(level, log, handler) {
        if (
          log.cause &&
          (log.cause as any).message === `Can't resolve original location of error.`
        ) {
          return;
        }
        handler(level, log);
      },
    },
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, "src/index.tsx"),
      formats: ["es"],
      fileName: (format, entryName) => `${entryName}.js`,
    },
  },
  server: {
    watch: {
      usePolling: true,
    },
  },
});
