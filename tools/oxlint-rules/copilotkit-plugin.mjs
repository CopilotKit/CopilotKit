import requireCpkPrefix from "./require-cpk-prefix.mjs";
import noSingleArgZodRecord from "./no-single-arg-zod-record.mjs";
import noPublicEnvShellRead from "./no-public-env-shell-read.mjs";

const plugin = {
  meta: { name: "copilotkit" },
  rules: {
    "require-cpk-prefix": requireCpkPrefix,
    "no-single-arg-zod-record": noSingleArgZodRecord,
    "no-public-env-shell-read": noPublicEnvShellRead,
  },
};

export default plugin;
