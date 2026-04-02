import requireCpkPrefix from "./require-cpk-prefix.mjs";

const plugin = {
  meta: { name: "copilotkit" },
  rules: {
    "require-cpk-prefix": requireCpkPrefix,
  },
};

export default plugin;
