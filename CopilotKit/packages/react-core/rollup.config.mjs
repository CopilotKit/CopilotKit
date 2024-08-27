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
    { file: "./dist/index.js", name: "react-core", format: "umd", sourcemap: true },
    { file: "./dist/index.mjs", format: "es", sourcemap: true },
  ],
  watch: {
    include: "src/**",
  },
  plugins: [
    nodeExternals(),
    json(),
    typescript({ tsconfig: "./tsconfig.json" }),
    preserveDirectives({ suppressPreserveModulesWarning: true }),
    commonjs(),
    // resolve({
    //   browser: true,
    // }),
    sourceMaps(),
    postcss({
      extensions: [".css"],
      extract: false,
      modules: false,
      plugins: [postcssImport()],
    }),
  ],
  onwarn: (warning, warn) => {
    if (warning.code === "MODULE_LEVEL_DIRECTIVE") {
      return;
    }
    warn(warning);
  },
};

export default config;
