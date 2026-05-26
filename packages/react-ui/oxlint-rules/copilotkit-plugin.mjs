import requireCpkPrefix from "./require-cpk-prefix.mjs";
import noSingleArgZodRecord from "./no-single-arg-zod-record.mjs";

const plugin = {
  meta: { name: "copilotkit" },
  rules: {
    "require-cpk-prefix": requireCpkPrefix,
    "no-single-arg-zod-record": noSingleArgZodRecord,
  },
};

export default plugin;
