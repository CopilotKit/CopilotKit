import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import {
  MIN_OPT_OUT_REASON_LENGTH,
  checkDuplicatedConstants,
  evalNumericLiteralExpr,
  maskNonCode,
  readConstantDeclaration,
  scanTestSource,
} from "../lib/test-vacuity-core.js";
import type { Violation } from "../lib/test-vacuity-core.js";
import {
  ALLOWLIST_PATH,
  DUPLICATED_CONSTANTS_PATH,
  loadAllowlist,
  loadDuplicatedConstants,
  runGate,
} from "../validate-test-vacuity.js";
import { REPO_ROOT } from "./paths";

// ===========================================================================
// This file is BOTH the unit suite for the vacuity/drift gate AND the gate
// itself: the final `describe` runs it over the whole showcase tree and fails
// on anything not in the dated allowlist. It is picked up by the
// `pnpm exec vitest run` step ("Run build pipeline tests") in
// .github/workflows/showcase_validate.yml, which fires on every PR touching
// showcase/** — i.e. the gate rides CI that already runs today.
//
// Every violating snippet below lives in a STRING, so the gate scanning this
// very file must not flag them. That is asserted explicitly at the bottom.
// ===========================================================================

const rules = (vs: Violation[]): string[] => vs.map((v) => v.rule);
const scan = (src: string, file = "showcase/x/fake.test.ts"): Violation[] =>
  scanTestSource(file, src);

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

describe("maskNonCode", () => {
  it("preserves length and every newline so line numbers stay exact", () => {
    const src =
      'const a = 1; // note\nconst b = "str";\n/* x\ny */\nconst c = 2;\n';
    const masked = maskNonCode(src);
    expect(masked).toHaveLength(src.length);
    expect(masked.split("\n")).toHaveLength(src.split("\n").length);
  });

  it("blanks comments, strings and template literals but keeps code", () => {
    const masked = maskNonCode(
      "expect(1).toBe(1); // expect(Math.max(...xs)).toBe(0)\n",
    );
    expect(masked).toContain("expect(1).toBe(1);");
    expect(masked).not.toContain("Math.max");
  });

  it("does not mistake a URL inside a regex literal for a line comment", () => {
    // `/https?:\/\//` contains `//`. A naive comment stripper eats the rest of
    // the line and the code after it becomes invisible to every rule.
    const src = "const re = /https?:\\/\\//; expect(xs).toHaveLength(2);\n";
    const masked = maskNonCode(src);
    expect(masked).toContain("expect(xs).toHaveLength(2);");
  });

  it("treats `/` after an identifier or `)` as division, not a regex", () => {
    const src = "const r = total / count; const s = f(1) / 2; const t = 3;\n";
    expect(maskNonCode(src)).toContain("const t = 3;");
  });

  it("keeps a `/` inside a regex character class from closing the literal", () => {
    const src = "const re = /[/]x/; expect(ys).toHaveLength(1);\n";
    expect(maskNonCode(src)).toContain("expect(ys).toHaveLength(1);");
  });
});

// ---------------------------------------------------------------------------
// A1 — degenerate-input vacuity
// ---------------------------------------------------------------------------

describe("degenerate-spread-aggregate (A1)", () => {
  it("flags the REAL #6156 shape: expect(Math.max(...pages)) against a cap", () => {
    // Verbatim shape from useLiveStatus.supplemental-bounds.test.tsx:406-417.
    const src = `
      const EXPECTED_MAX_INITIAL_PAGES = 20;
      it("stops after the cap", () => {
        expect(runawaySupplementalPages.length).toBeLessThanOrEqual(
          EXPECTED_MAX_INITIAL_PAGES,
        );
        expect(Math.max(...runawaySupplementalPages)).toBeLessThanOrEqual(
          EXPECTED_MAX_INITIAL_PAGES,
        );
        expect(runawaySupplementalPages).not.toContain(
          EXPECTED_MAX_INITIAL_PAGES + 1,
        );
      });
    `;
    const found = scan(src).filter(
      (v) => v.rule === "degenerate-spread-aggregate",
    );
    expect(found).toHaveLength(1);
    expect(found[0].symbol).toBe("runawaySupplementalPages");
    expect(found[0].message).toContain("-Infinity");
  });

  it("flags the HOISTED variant — the aggregate reaches expect() via a const", () => {
    // Syntactically different from anything in the review, same defect: nothing
    // here mentions Math.max inside expect(), so a grep for the reviewed idiom
    // misses it entirely.
    const src = `
      it("caps the walk", () => {
        const highestPageRequested = Math.max(...pagesRequested);
        expect(highestPageRequested).toBeLessThanOrEqual(20);
      });
    `;
    const found = scan(src);
    expect(rules(found)).toContain("degenerate-spread-aggregate");
    expect(found[0].symbol).toBe("pagesRequested");
  });

  it("flags Math.min used as a LOWER bound (the +Infinity trapdoor)", () => {
    const src = `
      it("never goes below the floor", () => {
        expect(Math.min(...observedDelays)).toBeGreaterThanOrEqual(100);
      });
    `;
    expect(rules(scan(src))).toContain("degenerate-spread-aggregate");
  });

  it("flags a seeded spread too — Math.max(0, ...xs) is still 0 on empty", () => {
    const src = `
      it("reads at most once", () => {
        expect(Math.max(0, ...perPollCounts)).toBeLessThanOrEqual(1);
      });
    `;
    expect(rules(scan(src))).toContain("degenerate-spread-aggregate");
  });

  it("accepts a spread whose collection is pinned non-empty", () => {
    for (const guard of [
      "expect(pages).toHaveLength(4);",
      "expect(pages).not.toHaveLength(0);",
      "expect(pages.length).toBeGreaterThan(0);",
      "expect(pages.length).toBeGreaterThanOrEqual(1);",
      "expect(pages).toContain(1);",
      "expect(pages).toEqual([1, 2, 3]);",
    ]) {
      const src = `
        it("caps the walk", () => {
          ${guard}
          expect(Math.max(...pages)).toBeLessThanOrEqual(20);
        });
      `;
      expect(rules(scan(src)), guard).not.toContain(
        "degenerate-spread-aggregate",
      );
    }
  });

  it("rejects guards that are themselves satisfied by the empty input", () => {
    for (const nonGuard of [
      "expect(pages).toHaveLength(0);",
      "expect(pages).toEqual([]);",
      "expect(pages.length).toBeGreaterThanOrEqual(0);",
      "expect(pages).not.toContain(21);",
    ]) {
      const src = `
        it("caps the walk", () => {
          ${nonGuard}
          expect(Math.max(...pages)).toBeLessThanOrEqual(20);
        });
      `;
      expect(rules(scan(src)), nonGuard).toContain(
        "degenerate-spread-aggregate",
      );
    }
  });

  it("ignores Math.max with fixed arity and no spread", () => {
    const src = `it("x", () => { expect(Math.max(a, b)).toBeLessThan(9); });`;
    expect(rules(scan(src))).not.toContain("degenerate-spread-aggregate");
  });

  it("ignores a spread aggregate that never reaches an assertion", () => {
    const src = `
      const widest = Math.max(...columnWidths);
      function render() { return widest; }
    `;
    expect(rules(scan(src))).not.toContain("degenerate-spread-aggregate");
  });

  it("treats .map() as length-preserving: guarding the base is enough", () => {
    // Real shape from probes/frontend-matrix.test.ts — `first` is pinned to 32
    // and `.map` cannot shorten it, so this is NOT vacuous.
    const src = `
      it("shards evenly", () => {
        expect(first).toHaveLength(32);
        expect(Math.max(...first.map((shard) => shard.length))).toBeLessThanOrEqual(
          Math.min(...first.map((shard) => shard.length)) + 1,
        );
      });
    `;
    expect(rules(scan(src))).not.toContain("degenerate-filtered-aggregate");
  });

  it("does NOT accept a base-identifier guard for a FILTERED spread", () => {
    const src = `
      it("caps the reds", () => {
        expect(rows).toHaveLength(12);
        expect(Math.max(...rows.filter((r) => r.red).map((r) => r.age))).toBeLessThanOrEqual(60);
      });
    `;
    const found = scan(src).filter(
      (v) => v.rule === "degenerate-filtered-aggregate",
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain(
      "derived/filtered set can still be empty",
    );
  });

  it("honours a loop that guards every bucket of an object", () => {
    // Real shape from calculator-fixture-routing.test.ts, including the
    // two-argument `expect(value, message)` form.
    const src = `
      it("orders entries", () => {
        for (const [bucket, indices] of Object.entries(idx)) {
          expect(indices.length, \`no \${bucket} entries\`).toBeGreaterThan(0);
        }
        expect(Math.max(...idx.followUps)).toBeLessThan(Math.min(...leg1));
      });
    `;
    expect(rules(scan(src))).not.toContain("degenerate-spread-aggregate");
  });
});

describe("degenerate-filtered-aggregate (A1)", () => {
  it("flags .every() over a filtered collection — [].every(p) is always true", () => {
    const src = `
      it("all retries are backed off", () => {
        expect(attempts.filter((a) => a.retried).every((a) => a.delayMs >= 900)).toBe(true);
      });
    `;
    const found = scan(src);
    expect(rules(found)).toContain("degenerate-filtered-aggregate");
    expect(found[0].message).toContain(
      "[].every(p) is true for EVERY predicate",
    );
  });

  it("flags .reduce() over a filtered collection — the seed passes through", () => {
    const src = `
      it("stays under the cap", () => {
        expect(
          pages.filter((p) => p > 0).reduce((a, b) => Math.max(a, b), 0),
        ).toBeLessThanOrEqual(20);
      });
    `;
    expect(rules(scan(src))).toContain("degenerate-filtered-aggregate");
  });

  it("accepts a filtered aggregate whose filtered set is size-pinned", () => {
    const src = `
      it("all retries are backed off", () => {
        expect(attempts.filter((a) => a.retried)).toHaveLength(3);
        expect(attempts.filter((a) => a.retried).every((a) => a.delayMs >= 900)).toBe(true);
      });
    `;
    expect(rules(scan(src))).not.toContain("degenerate-filtered-aggregate");
  });

  it("ignores .every() with no filter in the chain", () => {
    const src = `
      it("all rows have keys", () => {
        expect(rows).toHaveLength(3);
        expect(rows.every((r) => r.key)).toBe(true);
      });
    `;
    expect(rules(scan(src))).not.toContain("degenerate-filtered-aggregate");
  });
});

// ---------------------------------------------------------------------------
// A2 — one-sided pins and hand-copied source-of-truth
// ---------------------------------------------------------------------------

describe("one-sided-tuned-constant (A2)", () => {
  it("flags the REAL #6156 pin: a cap asserted only as an upper bound", () => {
    // Verbatim structure of EXPECTED_MAX_INITIAL_PAGES, including prettier's
    // wrapped argument with its dangling comma. Reviewers PROVED that lowering
    // the production constant to 10 — and to 5 — kept this suite green.
    const src = `
      /**
       * The supplemental fetch's page cap. MUST match \`MAX_INITIAL_FETCH_PAGES\` in
       * \`useLiveStatus.ts\`; pinned as a literal here on purpose.
       */
      const EXPECTED_MAX_INITIAL_PAGES = 20;

      it("stops at the cap", () => {
        expect(pagesRequested.length).toBeLessThanOrEqual(
          EXPECTED_MAX_INITIAL_PAGES,
        );
        expect(pagesRequested).not.toContain(EXPECTED_MAX_INITIAL_PAGES + 1);
      });
    `;
    const found = scan(src).filter(
      (v) => v.rule === "one-sided-tuned-constant",
    );
    expect(found).toHaveLength(1);
    expect(found[0].symbol).toBe("EXPECTED_MAX_INITIAL_PAGES");
    expect(found[0].message).toContain("silently LOWERED");
  });

  it("flags the mirror image: a floor asserted only as a lower bound", () => {
    const src = `
      // Drift guard: must equal MIN_POLL_INTERVAL_MS in the worker.
      const EXPECTED_MIN_POLL_MS = 250;
      it("floors the poll", () => {
        expect(observedIntervalMs).toBeGreaterThanOrEqual(EXPECTED_MIN_POLL_MS);
      });
    `;
    const found = scan(src).filter(
      (v) => v.rule === "one-sided-tuned-constant",
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("silently RAISED");
  });

  it("accepts a genuinely two-sided pin", () => {
    const src = `
      // MUST match MAX_INITIAL_FETCH_PAGES.
      const EXPECTED_MAX_INITIAL_PAGES = 20;
      it("stops exactly at the cap", () => {
        expect(pagesRequested.length).toBeLessThanOrEqual(EXPECTED_MAX_INITIAL_PAGES);
        expect(pagesRequested.length).toBeGreaterThanOrEqual(EXPECTED_MAX_INITIAL_PAGES);
      });
    `;
    expect(rules(scan(src))).not.toContain("one-sided-tuned-constant");
  });

  it("accepts an exact pin (toBe / toContain on the bare constant)", () => {
    for (const matcher of [
      "expect(pagesRequested.length).toBe(EXPECTED_MAX_INITIAL_PAGES);",
      "expect(pagesRequested).toContain(EXPECTED_MAX_INITIAL_PAGES);",
      "expect(pagesRequested).toHaveLength(EXPECTED_MAX_INITIAL_PAGES);",
    ]) {
      const src = `
        // MUST match MAX_INITIAL_FETCH_PAGES.
        const EXPECTED_MAX_INITIAL_PAGES = 20;
        it("x", () => {
          expect(pagesRequested.length).toBeLessThanOrEqual(EXPECTED_MAX_INITIAL_PAGES);
          ${matcher}
        });
      `;
      expect(rules(scan(src)), matcher).not.toContain(
        "one-sided-tuned-constant",
      );
    }
  });

  it("does not count CONST + 1 as pinning CONST", () => {
    // This is precisely how the real guard read as two-sided while being
    // one-sided: `not.toContain(CAP + 1)` constrains the neighbour, not the cap.
    const src = `
      // MUST match MAX_INITIAL_FETCH_PAGES.
      const EXPECTED_MAX_INITIAL_PAGES = 20;
      it("x", () => {
        expect(pagesRequested.length).toBeLessThanOrEqual(EXPECTED_MAX_INITIAL_PAGES);
        expect(pagesRequested).toContain(EXPECTED_MAX_INITIAL_PAGES + 1);
      });
    `;
    expect(rules(scan(src))).toContain("one-sided-tuned-constant");
  });

  it("leaves untagged numeric constants alone (no pin intent declared)", () => {
    const src = `
      const PER_PAGE_CLAMP = 500;
      it("x", () => { expect(perPage).toBeLessThanOrEqual(PER_PAGE_CLAMP); });
    `;
    expect(rules(scan(src))).not.toContain("one-sided-tuned-constant");
  });

  it("honours the explicit tunedConstants registry for undocumented pins", () => {
    const src = `
      const PER_PAGE_CLAMP = 500;
      it("x", () => { expect(perPage).toBeLessThanOrEqual(PER_PAGE_CLAMP); });
    `;
    const found = scanTestSource("showcase/x/fake.test.ts", src, [
      {
        file: "showcase/x/fake.test.ts",
        constant: "PER_PAGE_CLAMP",
        reason: "mirrors the PocketBase perPage clamp",
      },
    ]);
    expect(rules(found)).toContain("one-sided-tuned-constant");
  });
});

describe("pin-comment-without-import (A2)", () => {
  it("flags a hand-copied constant the file claims MUST match another module", () => {
    const src = `
      /** MUST match \`MAX_INITIAL_FETCH_PAGES\` in useLiveStatus.ts. */
      const EXPECTED_MAX_INITIAL_PAGES = 20;
    `;
    const found = scan(src).filter(
      (v) => v.rule === "pin-comment-without-import",
    );
    expect(found).toHaveLength(1);
    expect(found[0].symbol).toBe("MAX_INITIAL_FETCH_PAGES");
  });

  it("is satisfied when the identifier is actually imported", () => {
    const src = `
      import { MAX_INITIAL_FETCH_PAGES } from "./useLiveStatus";
      /** MUST match \`MAX_INITIAL_FETCH_PAGES\`. */
      const EXPECTED = MAX_INITIAL_FETCH_PAGES;
    `;
    expect(rules(scan(src))).not.toContain("pin-comment-without-import");
  });

  it("does not fire on prose that merely contains the words", () => {
    const src = `
      // The response shape must match the wire contract described above.
      const x = 1;
    `;
    expect(rules(scan(src))).not.toContain("pin-comment-without-import");
  });
});

// ---------------------------------------------------------------------------
// Opt-out hygiene
// ---------------------------------------------------------------------------

describe("opt-out marker", () => {
  const offending = `
    it("caps the walk", () => {
      MARKER
      expect(Math.max(...pages)).toBeLessThanOrEqual(20);
    });
  `;

  it("suppresses a rule when given a real justification", () => {
    const src = offending.replace(
      "MARKER",
      "// vacuity-gate-allow: degenerate-spread-aggregate — the server always serves page 1, proven by the honest-server suite",
    );
    expect(rules(scan(src))).not.toContain("degenerate-spread-aggregate");
  });

  it("reports a marker with no justification instead of honouring it", () => {
    const src = offending.replace(
      "MARKER",
      "// vacuity-gate-allow: degenerate-spread-aggregate",
    );
    const found = rules(scan(src));
    expect(found).toContain("opt-out-without-reason");
    expect(found).toContain("degenerate-spread-aggregate");
  });

  it("requires a reason of at least MIN_OPT_OUT_REASON_LENGTH characters", () => {
    const src = offending.replace(
      "MARKER",
      "// vacuity-gate-allow: degenerate-spread-aggregate — nope",
    );
    expect(rules(scan(src))).toContain("opt-out-without-reason");
    expect(MIN_OPT_OUT_REASON_LENGTH).toBeGreaterThan(4);
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — duplicated-constant drift
// ---------------------------------------------------------------------------

describe("evalNumericLiteralExpr", () => {
  it("evaluates the arithmetic forms these constants are written in", () => {
    expect(evalNumericLiteralExpr("5 * 60 * 1000")).toBe(300_000);
    expect(evalNumericLiteralExpr("2_000")).toBe(2000);
    expect(evalNumericLiteralExpr("(30 + 15) * 1000")).toBe(45_000);
    expect(evalNumericLiteralExpr("7")).toBe(7);
  });

  it("refuses anything that is not a literal arithmetic expression", () => {
    expect(evalNumericLiteralExpr("BASE * 2")).toBeNull();
    expect(evalNumericLiteralExpr('"5"')).toBeNull();
    expect(evalNumericLiteralExpr("computeWindow()")).toBeNull();
    expect(evalNumericLiteralExpr("5 * ")).toBeNull();
  });
});

describe("readConstantDeclaration", () => {
  it("finds an exported and a module-private declaration", () => {
    expect(
      readConstantDeclaration("export const A = 5 * 60 * 1000;\n", "A")?.value,
    ).toBe(300_000);
    expect(readConstantDeclaration("const B = 1_500;\n", "B")?.value).toBe(
      1500,
    );
  });

  it("does not match a mention inside a comment or a string", () => {
    const src = '// const C = 9;\nconst s = "const C = 8;";\n';
    expect(readConstantDeclaration(src, "C")).toBeNull();
  });
});

describe("checkDuplicatedConstants (rule 3)", () => {
  const pin = {
    reason: "test pin",
    declarations: [
      { file: "a.ts", constant: "A_MS" },
      { file: "b.ts", constant: "B_MS" },
    ],
  };

  it("passes while the duplicates hold the same value", () => {
    const found = checkDuplicatedConstants([pin], (f) =>
      f === "a.ts"
        ? "export const A_MS = 5 * 60 * 1000;"
        : "const B_MS = 300000;",
    );
    expect(found).toEqual([]);
  });

  it("FAILS with both values when they drift", () => {
    const found = checkDuplicatedConstants([pin], (f) =>
      f === "a.ts"
        ? "export const A_MS = 5 * 60 * 1000;"
        : "const B_MS = 10 * 60 * 1000;",
    );
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe("duplicated-constant-drift");
    expect(found[0].message).toContain("600000");
    expect(found[0].message).toContain("300000");
  });

  it("FAILS when a declaration is renamed away — a rename must not disable the pin", () => {
    const found = checkDuplicatedConstants([pin], (f) =>
      f === "a.ts"
        ? "export const A_MS = 300000;"
        : "const RENAMED_MS = 300000;",
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("no longer declared");
  });

  it("FAILS when a pinned file disappears", () => {
    const found = checkDuplicatedConstants([pin], (f) =>
      f === "a.ts" ? "export const A_MS = 300000;" : null,
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("does not exist");
  });

  it("FAILS when an initializer stops being comparable", () => {
    const found = checkDuplicatedConstants([pin], (f) =>
      f === "a.ts"
        ? "export const A_MS = 300000;"
        : "const B_MS = computeWindow();",
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("cannot be compared");
  });
});

// ---------------------------------------------------------------------------
// Registry + allowlist integrity
// ---------------------------------------------------------------------------

describe("gate configuration", () => {
  it("loads the allowlist with every entry dated, justified and owned", () => {
    // loadAllowlist throws on a malformed entry; this asserts it and pins the
    // shape so an undated/unowned entry cannot be slipped in.
    const entries = loadAllowlist();
    for (const e of entries) {
      expect(e.added).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.justification.length).toBeGreaterThan(30);
      expect(e.owner.length).toBeGreaterThan(0);
    }
    expect(fs.existsSync(ALLOWLIST_PATH)).toBe(true);
  });

  it("keeps at least one duplicated-constant pin registered", () => {
    // Emptying `pins` would make rule 3 pass trivially. The registry is the
    // rule's whole input, so a non-empty floor is what stops it being gutted.
    const config = loadDuplicatedConstants();
    expect(config.pins.length).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(DUPLICATED_CONSTANTS_PATH)).toBe(true);
    for (const p of config.pins) {
      expect(p.declarations.length).toBeGreaterThanOrEqual(2);
      expect(p.reason.length).toBeGreaterThan(30);
    }
  });

  it("pins the live COMM_ERROR_FUTURE_SKEW_TOLERANCE_MS / FUTURE_SKEW_TOLERANCE_MS pair", () => {
    // The concrete instance the gate was built for. Asserted here by NAME as
    // well as by value, so dropping it from the registry breaks a test rather
    // than silently removing the guard.
    const config = loadDuplicatedConstants();
    const names = config.pins.flatMap((p) =>
      p.declarations.map((d) => d.constant),
    );
    expect(names).toContain("COMM_ERROR_FUTURE_SKEW_TOLERANCE_MS");
    expect(names).toContain("FUTURE_SKEW_TOLERANCE_MS");
  });
});

// ---------------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------------

describe("showcase test-vacuity gate", () => {
  const result = runGate(REPO_ROOT);

  it("scans the showcase test tree", () => {
    // A path/glob regression that silently scanned nothing would make every
    // assertion below pass vacuously — exactly the class this gate polices.
    expect(result.filesScanned).toBeGreaterThan(500);
  });

  it("finds no vacuous assertions or constant drift outside the allowlist", () => {
    const report = result.violations
      .map((v) => `${v.file}:${v.line} [${v.rule}] ${v.message}`)
      .join("\n\n");
    expect(report).toBe("");
  });

  it("has no STALE allowlist entries (the allowlist is shrink-only)", () => {
    const report = result.stale
      .map(
        (s) =>
          `${s.file} [${s.rule}] \`${s.symbol}\` no longer fires — delete this entry (added ${s.added}, owner ${s.owner})`,
      )
      .join("\n");
    expect(report).toBe("");
  });

  it("does not flag the violating snippets in THIS file (they are all strings)", () => {
    const self = path.join(
      REPO_ROOT,
      "showcase/scripts/__tests__/validate-test-vacuity.test.ts",
    );
    const found = scanTestSource(
      "showcase/scripts/__tests__/validate-test-vacuity.test.ts",
      fs.readFileSync(self, "utf8"),
    );
    expect(found).toEqual([]);
  });
});
