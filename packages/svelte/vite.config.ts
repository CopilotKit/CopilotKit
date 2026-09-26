import { resolve } from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import dts from "vite-plugin-dts";
import packageJson from "./package.json";

const runtimeDependencies = Object.keys(packageJson.dependencies);

function isExternal(id: string) {
  return (
    id === "svelte" ||
    id.startsWith("svelte/") ||
    runtimeDependencies.some(
      (dependency) => id === dependency || id.startsWith(`${dependency}/`),
    )
  );
}

export default defineConfig({
  plugins: [
    svelte(),
    dts({
      tsconfigPath: resolve(__dirname, "tsconfig.json"),
      outDir: "dist",
      include: ["src/**/*.ts", "src/**/*.svelte"],
      exclude: ["src/**/__tests__/**"],
      rollupTypes: true,
    }),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "CopilotKitSvelte",
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "index.mjs" : "index.cjs"),
    },
    rollupOptions: {
      external: isExternal,
      output: {
        globals: { svelte: "Svelte" },
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
