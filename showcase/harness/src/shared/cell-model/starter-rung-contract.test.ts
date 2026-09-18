/**
 * Each starter rung's user-visible assertion must restate the request the
 * DRIVER ACTUALLY SENDS.
 *
 * WHY THIS SHAPE. A lint test that checks "the tooltips agree with the rung
 * table" is circular: the table and the tooltip have the same author, and the
 * defect being closed is exactly an author writing a claim the probe never
 * made. The legacy `interaction` rung was tooltipped
 *
 *     "UI interactions work, no console errors"
 *
 * while issuing a bare `GET /` — a claim about a Playwright spec, not about
 * the probe that wrote the row. A table-vs-tooltip lint cannot see that.
 *
 * So this test reads the method, the path template and the context header from
 * `STARTER_RUNG_REQUESTS` in `starter-smoke.ts` — the SAME constants the driver
 * builds its requests from — and asserts each rung's assertion string contains
 * them. A hand-written gloss that drifts from the request fails.
 *
 * MUTATIONS THAT RED THIS FILE:
 *   - reword any rung's `assertion` so it no longer names its request line;
 *   - change a rung's request in the driver without updating its assertion;
 *   - drop "mocked" from S3;
 *   - reintroduce a DOM/console claim on any rung.
 */
import { describe, it, expect } from "vitest";
import { STARTER_RUNGS } from "./cell-model.js";
import { STARTER_AXIS } from "./cell-model.combine.js";
import { STARTER_ROW_LEVELS } from "./live-status.js";
import {
  STARTER_RUNG_REQUESTS,
  S3_ORDERING_ASSERTIONS,
} from "../../probes/drivers/starter-smoke.js";

describe("starter rung contract", () => {
  it("the rung table, the axis and the row-key levels describe ONE ladder", () => {
    expect(STARTER_RUNGS.map((r) => r.kind)).toEqual([
      ...STARTER_AXIS.ladderKinds,
    ]);
    expect(STARTER_RUNGS.map((r) => r.level)).toEqual([...STARTER_ROW_LEVELS]);
    expect(STARTER_RUNGS.map((r) => r.depth)).toEqual([1, 2, 3]);
    // The row-key segments and the user-visible labels are two namespaces and
    // neither is derived from the other — `D3 chat (mocked)` is keyed
    // `agentrun`. Asserted so the difference reads as deliberate.
    //
    // The labels read `D<n>`, the SAME notation the feature cells use, and
    // carry no `/3` denominator (a feature chip reads `D6`, not `D6/6`). They
    // deliberately do NOT match the `S<n>` `kind`, which is a key into
    // `firstStrikeConfig`/`STALE_WINDOW_BY_KIND` where the starter and agent
    // rungs at the same depth hold different values.
    expect(STARTER_RUNGS.map((r) => r.label)).toEqual([
      "D1 http",
      "D2 info",
      "D3 chat (mocked)",
    ]);
    // No rung label may carry a denominator — `D3/3` on every cell is a
    // constant that reads like a score.
    for (const rung of STARTER_RUNGS) {
      expect(
        rung.label,
        `${rung.kind} label carries a denominator`,
      ).not.toMatch(/\/\s*\d/);
      expect(rung.label, `${rung.kind} label uses the S-prefix`).not.toMatch(
        /^S\d/,
      );
    }
  });

  it("each rung's assertion restates the request the DRIVER sends", () => {
    for (const rung of STARTER_RUNGS) {
      const req =
        STARTER_RUNG_REQUESTS[rung.kind as keyof typeof STARTER_RUNG_REQUESTS];
      expect(req, `no driver request for ${rung.kind}`).toBeDefined();
      // Same row key on both sides — this is what ties a rung's assertion to
      // the request that produced its row.
      expect(req.level).toBe(rung.level);
      expect(rung.assertion, `${rung.kind} method`).toContain(req.method);
      // The path template, minus the `<agentId>` placeholder the driver fills
      // in per starter.
      const pathLiteral = req.pathTemplate.split("<")[0] as string;
      expect(rung.assertion, `${rung.kind} path`).toContain(pathLiteral);
      if ("header" in req && req.header) {
        expect(rung.assertion, `${rung.kind} header`).toContain(req.header);
      }
    }
  });

  it("S3 says MOCKED, because a green S3 is not a claim about a real model", () => {
    const s3 = STARTER_RUNGS.find((r) => r.kind === "S3")!;
    expect(s3.assertion.toLowerCase()).toContain("mocked");
    expect(s3.label.toLowerCase()).toContain("mocked");
    expect(s3.label).toBe("D3 chat (mocked)");
    // `llamaindex` is red precisely because its client ignored
    // OPENAI_BASE_URL and hit the real OpenAI, so "a round trip against the
    // RECORDING succeeded" is the only thing a green S3 may be read as.
  });

  it("no rung claims DOM or console coverage — no browser rung exists in v1", () => {
    for (const rung of STARTER_RUNGS) {
      const text = `${rung.label} ${rung.assertion}`.toLowerCase();
      for (const forbidden of ["console", "dom", "browser", "click"]) {
        expect(text, `${rung.kind} claims "${forbidden}"`).not.toContain(
          forbidden,
        );
      }
    }
  });

  it("S1 does not overstate: it says the ROOT URL answered, not that a shell serves", () => {
    const s1 = STARTER_RUNGS.find((r) => r.kind === "S1")!;
    // Already false for the langgraph trio, which return 200 on `/` while
    // serving a materially older frontend build. "The Next app shell serves"
    // would be an untrue claim on a green rung.
    expect(s1.assertion.toLowerCase()).not.toContain("shell serves");
    expect(s1.assertion.toLowerCase()).not.toContain("app serves");
    expect(s1.assertion).toMatch(/2xx|200/);
  });

  it("the four S3 ordering assertions are named, and reported by name", () => {
    // Named rather than folded into one boolean so the Phase-0 exit criterion
    // can record the FIRST FAILING assertion per column — which is what turns
    // "all 7 healthy starters render green" from a prediction into a funded
    // observation.
    expect([...S3_ORDERING_ASSERTIONS]).toEqual([
      "run-started-first",
      "text-message-start-end-pairing",
      "thread-run-id-echo",
      "run-finished-last",
    ]);
  });
});
