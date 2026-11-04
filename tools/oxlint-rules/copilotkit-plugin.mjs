import requireCpkPrefix from "./require-cpk-prefix.mjs";
import noSingleArgZodRecord from "./no-single-arg-zod-record.mjs";
import noPublicEnvShellRead from "./no-public-env-shell-read.mjs";
import noSwallowedError from "./no-swallowed-error.mjs";
import requireDisableReason from "./require-disable-reason.mjs";

const plugin = {
  meta: { name: "copilotkit" },
  rules: {
    "require-cpk-prefix": requireCpkPrefix,
    "no-single-arg-zod-record": noSingleArgZodRecord,
    "no-public-env-shell-read": noPublicEnvShellRead,
    "no-swallowed-error": noSwallowedError,
    "require-disable-reason": requireDisableReason,
  },
};

export default plugin;
