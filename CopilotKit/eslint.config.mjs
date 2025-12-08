import customConfig from "./utilities/eslint-config-custom/index.mjs";

export default [
  ...customConfig,
  {
    settings: {
      next: {
        rootDir: ["examples/*/"],
      },
    },
  },
];
