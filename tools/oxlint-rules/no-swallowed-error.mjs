/**
 * Oxlint rule: no-swallowed-error
 *
 * Reports error handlers that do nothing, so an error goes away with no trace.
 *
 * Reported shapes:
 *
 * - `try { ... } catch {}` and `try { ... } catch (e) {}`
 * - `p.catch(() => {})` and `p.catch(function () {})`
 * - `p.catch(() => undefined)`, `p.catch(() => null)`, `p.catch(() => void 0)`
 * - The second argument of `p.then(onOk, () => {})`, with the same shapes
 * - Optional calls such as `p?.catch(() => {})`
 *
 * A comment inside the empty handler marks the ignore as intentional, and the
 * rule does not report it:
 *
 *   try { cleanup(); } catch {
 *     // Cleanup is best effort. The socket can already be closed.
 *   }
 *
 * A handler that does any work passes, for example `(e) => log(e)` or
 * `() => fallback`.
 */

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow empty error handlers that hide errors with no trace",
    },
    schema: [],
    messages: {
      emptyCatchClause:
        "This catch block is empty, so the error is lost. Handle the error, rethrow it, or add a comment in the block that says why it is safe to ignore.",
      emptyHandler:
        "This error handler does nothing, so the error is lost. Handle the error, rethrow it, or add a comment in the handler that says why it is safe to ignore.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;

    function hasComment(node) {
      return sourceCode.getCommentsInside(node).length > 0;
    }

    function isEmptyBlock(block) {
      return block.body.length === 0 && !hasComment(block);
    }

    function isNothingValue(expression) {
      switch (expression.type) {
        case "Identifier":
          return expression.name === "undefined";
        case "Literal":
          return expression.raw === "null";
        case "UnaryExpression":
          return (
            expression.operator === "void" &&
            expression.argument.type === "Literal" &&
            expression.argument.value === 0
          );
        default:
          return false;
      }
    }

    function isEmptyHandler(handler) {
      const isFunction =
        handler.type === "ArrowFunctionExpression" ||
        handler.type === "FunctionExpression";
      if (!isFunction) return false;

      if (handler.body.type === "BlockStatement") {
        return isEmptyBlock(handler.body);
      }
      return isNothingValue(handler.body) && !hasComment(handler);
    }

    function reportIfEmptyHandler(handler) {
      if (handler === undefined || !isEmptyHandler(handler)) return;
      context.report({ node: handler, messageId: "emptyHandler" });
    }

    return {
      CatchClause(node) {
        if (!isEmptyBlock(node.body)) return;
        context.report({ node, messageId: "emptyCatchClause" });
      },

      CallExpression(node) {
        const callee = node.callee;
        const isNamedMemberCall =
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.type === "Identifier";
        if (!isNamedMemberCall) return;

        switch (callee.property.name) {
          case "catch":
            reportIfEmptyHandler(node.arguments[0]);
            return;
          case "then":
            reportIfEmptyHandler(node.arguments[1]);
            return;
          default:
            return;
        }
      },
    };
  },
};

export default rule;
