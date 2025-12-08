import customConfig from "../../utilities/eslint-config-custom/index.mjs";

export default [
  ...customConfig,
  {
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
      "turbo/no-undeclared-env-vars": "off",
    },
  },
];
