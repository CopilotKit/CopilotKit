import { config as reactConfig } from "@copilotkitnext/eslint-config/react-internal";
import requireCpkPrefix from "./eslint-rules/require-cpk-prefix.mjs";

export default [
  ...reactConfig,
  {
    plugins: {
      copilotkit: {
        rules: {
          "require-cpk-prefix": requireCpkPrefix,
        },
      },
    },
    rules: {
      // Disable PropTypes validation since we use TypeScript for type checking
      "react/prop-types": "off",
      "copilotkit/require-cpk-prefix": "warn",
    },
  },
  // Disable cpk: prefix rule in test files — tests contain user-provided
  // className overrides that intentionally omit the prefix.
  {
    files: ["**/__tests__/**", "**/*.test.*", "**/*.spec.*"],
    rules: {
      "copilotkit/require-cpk-prefix": "off",
    },
  },
];
