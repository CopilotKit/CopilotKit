// import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import sourceMaps from "rollup-plugin-sourcemaps";
import typescript from "@rollup/plugin-typescript";
import postcss from "rollup-plugin-postcss";
import postcssImport from "postcss-import";
import json from "@rollup/plugin-json";
import preserveDirectives from "rollup-plugin-preserve-directives";
import nodeExternals from 'rollup-plugin-node-externals'

/** @type {import('rollup').RollupOptions} */
const config = {
  input: `src/index.tsx`,
  output: [
    { file: "./dist/index.js", name: "react-textarea", format: "umd", sourcemap: true },
    { file: "./dist/index.mjs", format: "es", sourcemap: true },
  ],
  watch: {
    include: "src/**",
  },
  external: ["react", "react-dom"],
  plugins: [
    nodeExternals(),
    json(),
    typescript({ tsconfig: "./tsconfig.json" }),
    preserveDirectives({ suppressPreserveModulesWarning: true }),
    commonjs(),
    sourceMaps(),
    postcss({
      extensions: [".css"],
      extract: false,
      modules: false,
      plugins: [postcssImport()],
    }),
    (() => {
      return {
        name: "styles-css-backwards-compatibility",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "styles.css",
            source: "/* This is an empty file for backwards compatibility */",
          });
        },
      };
    })(),
  ],
  onwarn: (warning, warn) => {
    if (warning.code === "MODULE_LEVEL_DIRECTIVE") {
      return;
    }
    warn(warning);
  },
};

export default config;
