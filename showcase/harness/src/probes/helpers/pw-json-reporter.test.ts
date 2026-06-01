/**
 * Playwright JSON-reporter parser tests.
 *
 * The parser turns a raw Playwright JSON report into a typed per-spec-
 * file verdict the fail-closed rollup can consume. The critical guard:
 * a report with zero collected cases produces NO pass row — it can never
 * manufacture green. A file is `red` if ANY case failed/timedOut; `pass`
 * only if at least one case ran and every ran case passed (skipped cases
 * are neutral).
 */
import { describe, it, expect } from "vitest";
import { parsePlaywrightJson } from "./pw-json-reporter.js";

const allPass = {
  suites: [
    {
      file: "hitl-in-chat.spec.ts",
      specs: [
        { title: "t1", tests: [{ results: [{ status: "passed" }] }] },
        { title: "t2", tests: [{ results: [{ status: "passed" }] }] },
      ],
    },
  ],
};

const oneFail = {
  suites: [
    {
      file: "frontend-tools.spec.ts",
      specs: [
        { title: "t1", tests: [{ results: [{ status: "passed" }] }] },
        { title: "t2", tests: [{ results: [{ status: "timedOut" }] }] },
      ],
    },
  ],
};

const empty = { suites: [] };

describe("parsePlaywrightJson", () => {
  it("all cases passed → file verdict pass", () => {
    const r = parsePlaywrightJson(allPass);
    expect(
      r.find((x) => x.specFile === "hitl-in-chat.spec.ts")?.fileVerdict,
    ).toBe("pass");
  });

  it("any failed/timedOut case → file verdict red", () => {
    const r = parsePlaywrightJson(oneFail);
    expect(
      r.find((x) => x.specFile === "frontend-tools.spec.ts")?.fileVerdict,
    ).toBe("red");
  });

  it("zero cases collected → unknown (never pass)", () => {
    const r = parsePlaywrightJson(empty);
    expect(r).toEqual([]); // no file rows; rollup treats absent as unknown
  });

  it("uses the basename of a nested suite file path", () => {
    const nested = {
      suites: [
        {
          file: "tests/e2e/auth.spec.ts",
          specs: [
            { title: "t1", tests: [{ results: [{ status: "passed" }] }] },
          ],
        },
      ],
    };
    const r = parsePlaywrightJson(nested);
    expect(r.map((x) => x.specFile)).toEqual(["auth.spec.ts"]);
  });

  it("recurses into nested child suites and groups cases by file", () => {
    // Playwright nests a describe block as a child suite that inherits its
    // parent's file. Cases at any depth must roll up to the file verdict.
    const report = {
      suites: [
        {
          file: "agentic-chat.spec.ts",
          specs: [
            { title: "top", tests: [{ results: [{ status: "passed" }] }] },
          ],
          suites: [
            {
              file: "agentic-chat.spec.ts",
              specs: [
                {
                  title: "nested-fail",
                  tests: [{ results: [{ status: "failed" }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const r = parsePlaywrightJson(report);
    expect(r).toHaveLength(1);
    expect(r[0]?.specFile).toBe("agentic-chat.spec.ts");
    expect(r[0]?.fileVerdict).toBe("red");
    expect(r[0]?.cases).toHaveLength(2);
  });

  it("a collected-but-never-ran case (empty results) taints the file to unknown, never pass", () => {
    // A run interrupted/aborted before this case executes leaves the case
    // collected with empty `results`. Dropping it silently would collapse
    // [passed, never-ran] → [passed] → pass, manufacturing green from a
    // partial run. Fail-closed: the file must be `unknown`, not pass.
    const partial = {
      suites: [
        {
          file: "aborted.spec.ts",
          specs: [
            { title: "t1", tests: [{ results: [{ status: "passed" }] }] },
            { title: "t2", tests: [{ results: [] }] },
          ],
        },
      ],
    };
    const r = parsePlaywrightJson(partial);
    expect(r.find((x) => x.specFile === "aborted.spec.ts")?.fileVerdict).toBe(
      "unknown",
    );
  });

  it("a failed sibling still wins over a never-ran case → red", () => {
    const partialWithFail = {
      suites: [
        {
          file: "aborted-fail.spec.ts",
          specs: [
            { title: "t1", tests: [{ results: [{ status: "failed" }] }] },
            { title: "t2", tests: [{ results: [] }] },
          ],
        },
      ],
    };
    const r = parsePlaywrightJson(partialWithFail);
    expect(
      r.find((x) => x.specFile === "aborted-fail.spec.ts")?.fileVerdict,
    ).toBe("red");
  });

  it("retry where the last result passes → pass (retried-pass preserved)", () => {
    const retried = {
      suites: [
        {
          file: "retry.spec.ts",
          specs: [
            { title: "t1", tests: [{ results: [{ status: "passed" }] }] },
            {
              title: "t2",
              tests: [
                { results: [{ status: "failed" }, { status: "passed" }] },
              ],
            },
          ],
        },
      ],
    };
    const r = parsePlaywrightJson(retried);
    expect(r.find((x) => x.specFile === "retry.spec.ts")?.fileVerdict).toBe(
      "pass",
    );
  });

  it("a file with only skipped cases is unknown, never pass", () => {
    const skipped = {
      suites: [
        {
          file: "voice.spec.ts",
          specs: [
            { title: "t1", tests: [{ results: [{ status: "skipped" }] }] },
          ],
        },
      ],
    };
    const r = parsePlaywrightJson(skipped);
    expect(r.find((x) => x.specFile === "voice.spec.ts")?.fileVerdict).toBe(
      "unknown",
    );
  });
});
