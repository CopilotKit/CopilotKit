import path from "path";
import fs from "fs";
import { defineConfig, Options } from "tsup-async-inject-style";
import postcss from "postcss";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import cssnano from "cssnano";
import postcssPrefixSelector from "postcss-prefix-selector";
import postcssImport from "postcss-import";
import postcssNested from "postcss-nested";

export default defineConfig((options: Options) => {
  return {
    entry: ["src/**/*.ts", "src/**/*.tsx"],
    format: ["esm", "cjs"],
    dts: true,
    minify: false,
    external: ["react"],
    splitting: false,
    clean: true,
    sourcemap: true,
    exclude: [
      "**/*.test.ts", // Exclude TypeScript test files
      "**/*.test.tsx", // Exclude TypeScript React test files
      "**/__tests__/*", // Exclude any files inside a __tests__ directory
    ],
    injectStyle: async (_, filePath) => {
      const cwd = process.cwd();
      const outputPath = path.resolve(cwd, "dist/index.css");
      const rawCSS = fs.readFileSync(filePath, "utf8");
      
      const resultCSS = await postcss([
        postcssImport(),
        postcssNested(),
        postcssPrefixSelector({
          prefix: ".copilot-kit-textarea-css-scope",
        }),
        tailwindcss,
        autoprefixer,
        cssnano({ preset: "default" }),
      ]).process(rawCSS, { from: filePath, to: outputPath });

      if (resultCSS.css === undefined) {
        throw new Error("No CSS output");
      }

      // Create index.css file for backwards compatibility
      fs.writeFileSync(path.resolve(cwd, "dist/index.css"), `/* This is here for backwards compatibility */`);
  
      return `
        if (globalThis.hasOwnProperty("document")) {
          const style = document?.createElement("style");
          style.innerHTML = '${resultCSS}';
          document?.head.appendChild(style);
        }
      `
    },
    ...options,
  };
});