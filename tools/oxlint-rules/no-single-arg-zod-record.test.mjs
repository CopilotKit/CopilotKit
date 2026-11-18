import { describe, it } from "vitest";
import { RuleTester } from "oxlint/plugins-dev";
import rule from "./no-single-arg-zod-record.mjs";

// oxlint's RuleTester relies on V8 APIs that only exist on Node >= 22, and
// throws at parse time on older runtimes. The CI unit matrix includes Node 20,
// so gate the RuleTester cases to supported runtimes. The lint rule itself is
// exercised on every Node version through `oxlint` in the lint job — this file
// only adds RuleTester-based unit coverage where the tester can run.
const ruleTesterSupported = Number(process.versions.node.split(".")[0]) >= 22;

if (ruleTesterSupported) {
  RuleTester.describe = describe;
  RuleTester.it = it;

  const ruleTester = new RuleTester();

  ruleTester.run("no-single-arg-zod-record", rule, {
    valid: [
      // Two-argument form is the correct, Zod 4-compatible shape.
      "const s = z.record(z.string(), z.unknown());",
      "const s = z.record(z.string(), z.number()).optional();",
      // A single-argument `.record()` on something that isn't the `z` alias
      // must not be flagged — this rule is scoped to Zod schemas.
      "const m = cache.record(entry);",
    ],
    invalid: [
      // Single-argument form: fires and autofixes by inserting the key schema.
      {
        code: "const s = z.record(z.unknown());",
        output: "const s = z.record(z.string(), z.unknown());",
        errors: [{ messageId: "singleArgRecord" }],
      },
      // Chained `.optional()` still fixes the inner z.record call.
      {
        code: "const s = z.record(z.unknown()).optional();",
        output: "const s = z.record(z.string(), z.unknown()).optional();",
        errors: [{ messageId: "singleArgRecord" }],
      },
      // A spread argument cannot be safely rewritten — report without a fix.
      {
        code: "const s = z.record(...valueTypes);",
        output: null,
        errors: [{ messageId: "singleArgRecord" }],
      },
    ],
  });
} else {
  describe("no-single-arg-zod-record", () => {
    it.skip("oxlint RuleTester requires Node >= 22; skipped on this runtime", () => {});
  });
}
