import { describe, it } from "vitest";
import { RuleTester } from "oxlint/plugins-dev";
import rule from "./no-swallowed-error.mjs";

// oxlint's RuleTester relies on V8 APIs that only exist on Node >= 22, and
// throws at parse time on older runtimes. The CI unit matrix includes Node 20,
// so gate the RuleTester cases to supported runtimes. The lint rule itself is
// exercised on every Node version through `oxlint` in the lint job; this file
// only adds RuleTester-based unit coverage where the tester can run.
const ruleTesterSupported = Number(process.versions.node.split(".")[0]) >= 22;

function invalid(code, messageId) {
  return { code, errors: [{ messageId }] };
}

if (ruleTesterSupported) {
  RuleTester.describe = describe;
  RuleTester.it = it;

  const ruleTester = new RuleTester();

  ruleTester.run("no-swallowed-error", rule, {
    valid: [
      // Catch blocks that do something with the error.
      "try { a(); } catch (e) { log(e); }",
      "try { a(); } catch { throw new Error('a failed'); }",
      // A comment inside the braces marks the ignore as intentional.
      "try { a(); } catch {\n  // best effort, the socket can already be closed\n}",
      "try { a(); } catch (e) { /* ignore: optional feature */ }",

      // Promise handlers that do something.
      "p.catch((e) => log(e));",
      "p.catch(() => fallback);",
      "p.catch(() => false);",
      "p.catch(() => void cleanup());",
      "p.catch(function (e) { report(e); });",
      "p.catch(noop);",
      "p.catch();",
      "p.then(onOk, (e) => log(e));",
      // An empty first `.then` argument is a success handler, not an error handler.
      "p.then(() => {});",
      // A comment inside the handler marks the ignore as intentional.
      "p.catch(() => {\n  // the request was aborted on purpose\n});",
      "p.catch(() => /* aborted on purpose */ undefined);",
      "p.then(onOk, () => { /* already reported upstream */ });",
      // Computed member access is out of scope.
      "p['catch'](() => {});",
    ],
    invalid: [
      // Empty catch clauses.
      invalid("try { a(); } catch {}", "emptyCatchClause"),
      invalid("try { a(); } catch (e) {}", "emptyCatchClause"),
      // A comment outside the braces does not count.
      invalid("// a can fail\ntry { a(); } catch {}", "emptyCatchClause"),

      // Empty `.catch` handlers.
      invalid("p.catch(() => {});", "emptyHandler"),
      invalid("p.catch((e) => {});", "emptyHandler"),
      invalid("p.catch(function () {});", "emptyHandler"),
      invalid("p.catch(async () => {});", "emptyHandler"),
      invalid("p.catch(() => undefined);", "emptyHandler"),
      invalid("p.catch(() => null);", "emptyHandler"),
      invalid("p.catch(() => void 0);", "emptyHandler"),
      invalid("p?.catch(() => {});", "emptyHandler"),
      invalid("fetchData().then(render).catch(() => {});", "emptyHandler"),

      // Empty second argument of `.then`.
      invalid("p.then(onOk, () => {});", "emptyHandler"),
      invalid("p.then(onOk, () => null);", "emptyHandler"),
      invalid("p?.then(onOk, () => undefined);", "emptyHandler"),
    ],
  });
} else {
  describe("no-swallowed-error", () => {
    it.skip("oxlint RuleTester requires Node >= 22; skipped on this runtime", () => {});
  });
}
