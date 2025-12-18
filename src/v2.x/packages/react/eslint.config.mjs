import { config as reactConfig } from "@copilotkitnext/eslint-config/react-internal";

export default [
  ...reactConfig,
  {
    rules: {
      // Disable PropTypes validation since we use TypeScript for type checking
      "react/prop-types": "off",
    },
  },
];
