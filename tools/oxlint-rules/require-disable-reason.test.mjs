import { describe, it } from "vitest";
import { RuleTester } from "oxlint/plugins-dev";
import rule from "./require-disable-reason.mjs";

// oxlint's RuleTester relies on V8 APIs that only exist on Node >= 22, and
// throws at parse time on older runtimes. The CI unit matrix includes Node 20,
// so gate the RuleTester cases to supported runtimes. The lint rule itself is
// exercised on every Node version through `oxlint` in the lint job — this file
// only adds RuleTester-based unit coverage where the tester can run.
const ruleTesterSupported = Number(process.versions.node.split(".")[0]) >= 22;

// Rule names in these cases (`foo`, `bar`, `demo/no-thing`) do not exist, so
// the directives cannot suppress this rule's own diagnostics inside the tester.
function missingReason(code, directive) {
  return {
    code,
    errors: [{ messageId: "missingReason", data: { directive } }],
  };
}

if (ruleTesterSupported) {
  RuleTester.describe = describe;
  RuleTester.it = it;

  const ruleTester = new RuleTester();

  ruleTester.run("require-disable-reason", rule, {
    valid: [
      // Every directive form passes with a reason.
      "// oxlint-disable foo -- generated file\nconst a = 1;",
      "const a = 1; // oxlint-disable-line foo -- legacy shape",
      "// oxlint-disable-next-line foo -- legacy shape\nconst a = 1;",
      "// eslint-disable foo -- generated file\nconst a = 1;",
      "const a = 1; // eslint-disable-line foo -- legacy shape",
      "// eslint-disable-next-line foo -- legacy shape\nconst a = 1;",
      // Block comment form, single line and with a JSDoc-style `*` prefix.
      "/* eslint-disable foo -- why */\nconst a = 1;",
      "/*\n * oxlint-disable foo -- why\n */\nconst a = 1;",
      // Multi-rule lists.
      "// oxlint-disable-next-line foo, demo/no-thing -- both are false positives here\nconst a = 1;",
      // Enable directives never need a reason.
      "// oxlint-enable foo\nconst a = 1;",
      "/* eslint-enable foo */\nconst a = 1;",
      // Prose that mentions a directive mid-sentence is not a directive.
      "// We avoid eslint-disable comments in this file.\nconst a = 1;",
      "/* Do not add oxlint-disable-next-line here. */\nconst a = 1;",
      // A word that only starts like a directive is not one.
      "// eslint-disabled rules are listed in the config\nconst a = 1;",
    ],
    invalid: [
      // Every directive form fails without a reason.
      missingReason("// oxlint-disable foo\nconst a = 1;", "oxlint-disable"),
      missingReason(
        "const a = 1; // oxlint-disable-line foo",
        "oxlint-disable-line",
      ),
      missingReason(
        "// oxlint-disable-next-line foo\nconst a = 1;",
        "oxlint-disable-next-line",
      ),
      missingReason("// eslint-disable foo\nconst a = 1;", "eslint-disable"),
      missingReason(
        "const a = 1; // eslint-disable-line foo",
        "eslint-disable-line",
      ),
      missingReason(
        "// eslint-disable-next-line foo\nconst a = 1;",
        "eslint-disable-next-line",
      ),
      // Block comment form without a reason.
      missingReason("/* eslint-disable foo */\nconst a = 1;", "eslint-disable"),
      // Multi-rule list without a reason.
      missingReason(
        "// oxlint-disable-next-line foo, bar\nconst a = 1;",
        "oxlint-disable-next-line",
      ),
      // `--` with nothing after it is not a reason.
      missingReason(
        "// oxlint-disable-next-line foo -- \nconst a = 1;",
        "oxlint-disable-next-line",
      ),
      missingReason(
        "/* eslint-disable foo -- */\nconst a = 1;",
        "eslint-disable",
      ),
      // `--` glued to the rule name is not the reason separator.
      missingReason(
        "// eslint-disable-next-line foo--why\nconst a = 1;",
        "eslint-disable-next-line",
      ),
      // The report lands on the comment, not on the code it disables.
      {
        code: "const a = 1;\n// oxlint-disable-next-line foo\nconst b = 2;",
        errors: [
          {
            messageId: "missingReason",
            line: 2,
            column: 0,
            endLine: 2,
            endColumn: 31,
          },
        ],
      },
    ],
  });
} else {
  describe("require-disable-reason", () => {
    it.skip("oxlint RuleTester requires Node >= 22; skipped on this runtime", () => {});
  });
}
