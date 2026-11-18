/**
 * Oxlint rule: require-disable-reason
 *
 * Every lint disable comment must say why the rule is off:
 *
 *   // oxlint-disable-next-line typescript/no-explicit-any -- legacy wire shape
 *
 * Checked directives (line and block comments):
 *   oxlint-disable, oxlint-disable-line, oxlint-disable-next-line,
 *   eslint-disable, eslint-disable-line, eslint-disable-next-line
 *
 * The directive must start the comment text. Leading whitespace and one
 * leading `*` (block comment continuation) are allowed. Enable directives and
 * prose that only mentions a directive mid-sentence are not checked.
 *
 * A reason is ` -- ` followed by at least one non-space character. oxlint
 * accepts the `-- reason` suffix and still applies the directive.
 *
 * Known limit: a bare `oxlint-disable` / `eslint-disable` with no rule list
 * turns off every rule for the file, this one included, so oxlint cannot
 * report it. Such comments are rare and easy to grep for.
 */

const DIRECTIVE =
  /^\s*\*?\s*((?:oxlint|eslint)-disable(?:-next-line|-line)?)(?=\s|$)/;
const REASON = /\s--\s+\S/;

const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require a `-- <reason>` on every lint disable comment",
    },
    schema: [],
    messages: {
      missingReason:
        "`{{directive}}` needs a reason. Write it as `// oxlint-disable-next-line <rule> -- <why>`.",
    },
  },

  create(context) {
    return {
      Program() {
        const comments = context.sourceCode.getAllComments();
        for (const comment of comments) {
          if (comment.type === "Shebang") continue;

          const match = DIRECTIVE.exec(comment.value);
          if (match === null) continue;

          const rest = comment.value.slice(match[0].length);
          if (REASON.test(rest)) continue;

          context.report({
            node: comment,
            messageId: "missingReason",
            data: { directive: match[1] },
          });
        }
      },
    };
  },
};

export default rule;
