/**
 * Oxlint rule: no-single-arg-zod-record
 *
 * Bans the single-argument `z.record(valueType)` form in favor of the
 * two-argument `z.record(z.string(), valueType)` form.
 *
 * Zod 4 made the key schema mandatory for z.record, so the single-argument
 * `z.record(valueType)` form is a compile-time error (TS2554) when built
 * against Zod 4 — even though it still parses fine at runtime under both Zod
 * majors. Packages that allow a Zod 4 peer (e.g. `@copilotkit/react-core`
 * declares `zod: ">=3.0.0"`) are affected. The two-argument
 * `z.record(z.string(), valueType)` form is valid under both Zod 3 and Zod 4.
 *
 * See GitHub issue #4295.
 *
 * Matches `z.record(...)` specifically (the conventional zod import alias in
 * this repo) to avoid flagging unrelated single-argument `.record()` calls.
 */

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow the single-argument z.record() form, which is removed in Zod 4",
    },
    fixable: "code",
    schema: [],
    messages: {
      singleArgRecord:
        "Use the two-argument form `z.record(z.string(), …)`. Zod 4 requires an explicit key schema, so the single-argument `z.record(value)` form is a compile-time error (TS2554) when built against Zod 4 (GitHub #4295).",
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          !callee ||
          callee.type !== "MemberExpression" ||
          callee.computed ||
          !callee.object ||
          callee.object.type !== "Identifier" ||
          callee.object.name !== "z" ||
          !callee.property ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "record"
        ) {
          return;
        }
        if (node.arguments.length !== 1) return;

        const arg = node.arguments[0];
        // A spread argument cannot be safely rewritten — report without a fix.
        if (arg.type === "SpreadElement") {
          context.report({ node, messageId: "singleArgRecord" });
          return;
        }

        context.report({
          node,
          messageId: "singleArgRecord",
          fix(fixer) {
            return fixer.insertTextBefore(arg, "z.string(), ");
          },
        });
      },
    };
  },
};

export default rule;
