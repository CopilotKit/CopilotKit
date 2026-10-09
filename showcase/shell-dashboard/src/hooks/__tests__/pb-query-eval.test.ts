/**
 * CONFORMANCE tests for the shared PocketBase query evaluator.
 *
 * These are not "does the helper do what the helper does" tests. Every
 * expectation below is an OBSERVED RESULT from a real PocketBase v0.22.21
 * server — the version `showcase/pocketbase/Dockerfile` pins — driven over HTTP
 * with a `status`-shaped collection holding exactly the rows in
 * `CONFORMANCE_ROWS`, plus the real `pocketbase` JS SDK's own `filter()` output.
 * The evaluator exists ONLY to stand in for that server inside the
 * `useLiveStatus` test doubles, so the thing worth pinning is agreement with
 * it, not self-consistency.
 *
 * The `// LIVE:` comment on each case is the verbatim result the real server
 * returned for that query. Three prior copies of this evaluator disagreed with
 * each other on four separate axes precisely because nothing anywhere compared
 * any of them to a real server.
 *
 * Re-derive the oracle by pointing a local PocketBase at a collection with
 * these rows and replaying the queries; every case names the query it sent.
 */
import { describe, it, expect } from "vitest";
import {
  matchesPbFilter,
  applyPbFields,
  applyPbSort,
  readPbListRequest,
  classifyPbListRequest,
  evaluatePbList,
  pbListBody,
  PbQueryError,
  PB_PER_PAGE_CLAMP,
} from "./pb-query-eval";
import type { PbRow } from "./pb-query-eval";

/** The exact rows the live oracle held. */
const CONFORMANCE_ROWS: PbRow[] = [
  { key: "smoke:int/f1", dimension: "smoke", state: "green", fail_count: 2 },
  { key: "d6:acme", dimension: "d6", state: "green", fail_count: 0 },
  { key: "d6:acme/chat", dimension: "d6", state: "red", fail_count: 10 },
  { key: "e2e:acme/chat", dimension: "e2e", state: "red", fail_count: 3 },
  { key: "MIXEDcase", dimension: "probe", state: "green", fail_count: 0 },
  { key: "xxAB", dimension: "probe", state: "green", fail_count: 0 },
  { key: "AB", dimension: "probe", state: "green", fail_count: 0 },
  { key: "A_B", dimension: "probe", state: "green", fail_count: 0 },
  { key: "AZB", dimension: "probe", state: "green", fail_count: 0 },
  { key: "xxA_Bxx", dimension: "probe", state: "green", fail_count: 0 },
];

/** Keys the evaluator selects, sorted, so a case reads as a set. */
function selected(filter: string): string[] {
  return CONFORMANCE_ROWS.filter((row) => matchesPbFilter(filter, row))
    .map((row) => String(row.key))
    .sort();
}

// ---------------------------------------------------------------------------

describe("pb-query-eval — the filters useLiveStatus actually builds", () => {
  // The bulk dimension scope. `pb.filter("dimension = {:dim}", {dim})` emits
  // SINGLE quotes (verified against the SDK: "dimension = 'smoke'"), so this is
  // the form that reaches the wire — and the form an earlier revision of this
  // evaluator could not tokenize AT ALL, throwing `unsupported character "'"`
  // on every dimension-scoped test.
  it("evaluates the single-quoted bulk dimension scope pb.filter() emits", () => {
    // LIVE: ["smoke:int/f1"]
    expect(selected("dimension = 'smoke'")).toEqual(["smoke:int/f1"]);
  });

  it("evaluates the dimension-scoped supplemental union", () => {
    const filter =
      `dimension = 'd6' && ((dimension = "d6" && key !~ "%/%") || ` +
      `(state != "green"))`;
    // LIVE: ["d6:acme","d6:acme/chat"]
    expect(selected(filter)).toEqual(["d6:acme", "d6:acme/chat"]);
  });

  it("evaluates the unscoped supplemental union", () => {
    const filter =
      `((dimension = "d6" || dimension = "d4" || dimension = "e2e-demos" || ` +
      `dimension = "d5-single-pill-e2e") && key !~ "%/%") || (state != "green")`;
    // LIVE: ["d6:acme","d6:acme/chat","e2e:acme/chat"]
    expect(selected(filter)).toEqual([
      "d6:acme",
      "d6:acme/chat",
      "e2e:acme/chat",
    ]);
  });

  it("selects NOTHING for an out-of-aggregate dimension scope over green rows", () => {
    // The property the autocancel suite's dropped-tail guards depend on: with
    // the comm-error clause dropped, an all-green fixture matches no
    // supplemental row at all, so the bulk fan-out is on its own.
    // LIVE: []
    expect(selected(`dimension = 'smoke' && (state != "green")`)).toEqual([]);
  });

  it("round-trips the \\' escape pb.filter() emits for an embedded apostrophe", () => {
    // LIVE: pb.filter("key = {:k}", { k: "it's" }) === "key = 'it\\'s'"
    expect(matchesPbFilter(String.raw`key = 'it\'s'`, { key: "it's" })).toBe(
      true,
    );
    expect(matchesPbFilter(String.raw`key = 'it\'s'`, { key: "its" })).toBe(
      false,
    );
  });

  it("reads the BARE literals pb.filter() emits for numbers, booleans and null", () => {
    // LIVE: pb.filter emits "fail_count > 2", "ok = true", "x = null".
    expect(selected("fail_count = 10")).toEqual(["d6:acme/chat"]);
    expect(matchesPbFilter("ok = true", { ok: true })).toBe(true);
    expect(matchesPbFilter("ok = false", { ok: true })).toBe(false);
    expect(
      matchesPbFilter("first_failure_at = null", {
        first_failure_at: null,
      }),
    ).toBe(true);
    expect(
      matchesPbFilter("first_failure_at != null", {
        first_failure_at: "2026-04-20T00:00:00Z",
      }),
    ).toBe(true);
  });
});

describe("pb-query-eval — LIKE follows PocketBase, not a hand-rolled guess", () => {
  it("is CASE-INSENSITIVE, like the SQL LIKE it compiles to", () => {
    // LIVE: key ~ 'mixedcase' → ["MIXEDcase"]
    expect(selected("key ~ 'mixedcase'")).toEqual(["MIXEDcase"]);
  });

  it("auto-wraps a wildcard-free pattern in %…% (contains)", () => {
    // LIVE: key ~ 'AB' → ["AB","xxAB"]
    expect(selected("key ~ 'AB'")).toEqual(["AB", "xxAB"]);
  });

  it("does NOT let `_` suppress the auto-wrap, and escapes it to a literal", () => {
    // The axis both prior copies got wrong from opposite directions: one
    // treated `_` as a wildcard AND as an anchor (matching AZB, missing
    // xxA_Bxx); the other wrapped correctly but left `_` a wildcard (matching
    // AZB). PocketBase's wrapLikeParams escapes `%` and `_` before wrapping.
    // LIVE: key ~ 'A_B' → ["A_B","xxA_Bxx"]   (note: NO "AZB")
    expect(selected("key ~ 'A_B'")).toEqual(["A_B", "xxA_Bxx"]);
  });

  it("treats `_` as a single-char wildcard when an explicit `%` is present", () => {
    // LIVE: key ~ '%A_B%' → ["AZB","A_B","xxA_Bxx"]
    expect(selected("key ~ '%A_B%'")).toEqual(["AZB", "A_B", "xxA_Bxx"]);
  });

  it("negates with !~ — the aggregate-key clause", () => {
    // LIVE: key !~ "%/%" → ["d6:acme","MIXEDcase","xxAB","AB","A_B","AZB","xxA_Bxx"]
    expect(selected(`key !~ "%/%"`)).toEqual([
      "AB",
      "AZB",
      "A_B",
      "MIXEDcase",
      "d6:acme",
      "xxAB",
      "xxA_Bxx",
    ]);
    // LIVE: key ~ "%/%" → ["smoke:int/f1","d6:acme/chat","e2e:acme/chat"]
    expect(selected(`key ~ "%/%"`)).toEqual([
      "d6:acme/chat",
      "e2e:acme/chat",
      "smoke:int/f1",
    ]);
  });
});

describe("pb-query-eval — ordering comparisons follow the COLUMN type", () => {
  it("compares a numeric column NUMERICALLY, not as text", () => {
    // A string comparison would drop fail_count 10, because "10" < "2".
    // LIVE: fail_count > 2  → ["d6:acme/chat","e2e:acme/chat"]
    expect(selected("fail_count > 2")).toEqual([
      "d6:acme/chat",
      "e2e:acme/chat",
    ]);
    // LIVE: fail_count >= 3 → ["d6:acme/chat","e2e:acme/chat"]
    expect(selected("fail_count >= 3")).toEqual([
      "d6:acme/chat",
      "e2e:acme/chat",
    ]);
    expect(selected("fail_count < 3")).toEqual([
      "AB",
      "AZB",
      "A_B",
      "MIXEDcase",
      "d6:acme",
      "smoke:int/f1",
      "xxAB",
      "xxA_Bxx",
    ]);
  });

  it("compares numerically even when the literal arrives quoted", () => {
    // PocketBase compares by column type, not by the literal's source form.
    expect(matchesPbFilter("fail_count > '2'", { fail_count: 10 })).toBe(true);
  });
});

describe("pb-query-eval — sort", () => {
  const rows: PbRow[] = [
    "AB",
    "AZB",
    "A_B",
    "MIXEDcase",
    "xxAB",
    "xxA_Bxx",
  ].map((key) => ({ key }));
  const keys = (sort: string): string[] =>
    applyPbSort(rows, sort).map((r) => String(r.key));

  it("ascends on a bare key and on an explicit +key", () => {
    // LIVE: sort=key and sort=+key → ["AB","AZB","A_B","MIXEDcase","xxAB","xxA_Bxx"]
    const asc = ["AB", "AZB", "A_B", "MIXEDcase", "xxAB", "xxA_Bxx"];
    expect(keys("key")).toEqual(asc);
    expect(keys("+key")).toEqual(asc);
  });

  it("DESCENDS on -key instead of silently no-opping", () => {
    // The `-` prefix used to be dropped on the floor, so a DESC sort was served
    // ascending and nothing could tell.
    // LIVE: sort=-key → ["xxA_Bxx","xxAB","MIXEDcase","A_B","AZB","AB"]
    expect(keys("-key")).toEqual([
      "xxA_Bxx",
      "xxAB",
      "MIXEDcase",
      "A_B",
      "AZB",
      "AB",
    ]);
  });

  it("orders a numeric key numerically and supports multiple keys", () => {
    const mixed: PbRow[] = [
      { g: "a", n: 10 },
      { g: "a", n: 2 },
      { g: "b", n: 1 },
    ];
    expect(applyPbSort(mixed, "n").map((r) => r.n)).toEqual([1, 2, 10]);
    expect(applyPbSort(mixed, "g,-n").map((r) => r.n)).toEqual([10, 2, 1]);
  });

  it("leaves rows alone for an absent or empty sort", () => {
    expect(applyPbSort(rows, null).map((r) => r.key)).toEqual(
      rows.map((r) => r.key),
    );
    expect(applyPbSort(rows, "  ").map((r) => r.key)).toEqual(
      rows.map((r) => r.key),
    );
  });

  it("throws on a sort it cannot apply rather than ignoring it", () => {
    expect(() => applyPbSort(rows, "@random")).toThrow(PbQueryError);
    expect(() => applyPbSort(rows, "-")).toThrow(/empty sort key/);
  });
});

describe("pb-query-eval — FAIL LOUD (never a silent match-everything)", () => {
  const row = CONFORMANCE_ROWS[0]!;

  // Real PocketBase answers every one of these with HTTP 400 — verified. None
  // of them may degrade to `true`.
  it("throws on an unterminated single-quoted literal", () => {
    // The previous tokenizer ACCEPTED this, reading to end-of-input as if the
    // quote had been closed, though its own contract said it would throw.
    expect(() => matchesPbFilter("dimension = 'smoke", row)).toThrow(
      /unterminated single-quoted literal/,
    );
  });

  it("throws on an unterminated double-quoted literal", () => {
    expect(() => matchesPbFilter('dimension = "smoke', row)).toThrow(
      /unterminated double-quoted literal/,
    );
  });

  it("throws on a bare WORD, which real PB reads as a column reference", () => {
    expect(() => matchesPbFilter("dimension = smoke", row)).toThrow(
      /not a number, boolean or null/,
    );
  });

  it("throws on a dangling operator, an unbalanced paren and trailing input", () => {
    expect(() => matchesPbFilter("dimension =", row)).toThrow(
      /expected a literal/,
    );
    expect(() => matchesPbFilter("(dimension = 'smoke'", row)).toThrow(
      /unbalanced parenthesis/,
    );
    expect(() => matchesPbFilter("dimension = 'smoke' junk", row)).toThrow(
      /trailing input/,
    );
  });

  it("throws on an unsupported operator", () => {
    expect(() => matchesPbFilter("dimension ?= 'smoke'", row)).toThrow(
      PbQueryError,
    );
  });

  it("throws on a field the row does not carry instead of reading it as empty", () => {
    // Real PB 400s on an unknown column. Reading it as "" made
    // `state != "green"` quietly select rows with no `state` at all.
    expect(() => matchesPbFilter("nope = 'x'", row)).toThrow(/does not carry/);
  });

  it("still matches everything for an ABSENT filter — that IS PB's behaviour", () => {
    expect(matchesPbFilter(null, row)).toBe(true);
    expect(matchesPbFilter(undefined, row)).toBe(true);
    expect(matchesPbFilter("   ", row)).toBe(true);
  });
});

describe("pb-query-eval — fields projection", () => {
  it("keeps only the projected keys and drops the rest", () => {
    const row: PbRow = { id: "1", key: "k", signal: { a: 1 }, state: "red" };
    expect(applyPbFields(row, "id,key")).toEqual({ id: "1", key: "k" });
    expect(applyPbFields(row, " id , state ")).toEqual({
      id: "1",
      state: "red",
    });
  });

  it("returns the full row for an absent projection, like real PB", () => {
    const row: PbRow = { id: "1", signal: {} };
    expect(applyPbFields(row, null)).toBe(row);
    expect(applyPbFields(row, "")).toBe(row);
  });
});

describe("pb-query-eval — request parsing", () => {
  const parse = (qs: string) =>
    readPbListRequest(new URL(`http://x/api/collections/status/records?${qs}`));

  it("clamps perPage the way the real server does", () => {
    expect(parse("perPage=5000").perPage).toBe(PB_PER_PAGE_CLAMP);
    expect(parse("perPage=1").perPage).toBe(1);
    expect(parse("").perPage).toBe(PB_PER_PAGE_CLAMP);
  });

  it("reads skipTotal, and treats blank params as unsent", () => {
    expect(parse("skipTotal=1").skipTotal).toBe(true);
    expect(parse("skipTotal=true").skipTotal).toBe(true);
    expect(parse("").skipTotal).toBe(false);
    expect(parse("filter=&fields=&sort=").filter).toBeNull();
    expect(parse("filter=&fields=&sort=").fields).toBeNull();
    expect(parse("filter=&fields=&sort=").sort).toBeNull();
  });

  it("throws on a non-numeric page instead of serving an empty page", () => {
    // NaN paging used to yield a silently EMPTY page, which the hook reads as
    // "end of collection" — a fake turning a bad request into a clean stop.
    expect(() => parse("page=abc")).toThrow(/page="abc"/);
    expect(() => parse("page=0")).toThrow(PbQueryError);
  });

  it("classifies the hook's three list callers", () => {
    expect(classifyPbListRequest(parse("perPage=1"))).toBe("heartbeat");
    expect(
      classifyPbListRequest(parse("perPage=500&fields=id,key,signal")),
    ).toBe("supplemental");
    expect(classifyPbListRequest(parse("perPage=500"))).toBe("supplemental");
    expect(classifyPbListRequest(parse("perPage=500&fields=id,key"))).toBe(
      "bulk",
    );
  });
});

describe("pb-query-eval — evaluatePbList is the whole endpoint, and never throws", () => {
  const parse = (qs: string) =>
    readPbListRequest(new URL(`http://x/api/collections/status/records?${qs}`));

  it("applies filter → sort → slice → projection → skipTotal envelope", () => {
    const req = parse(
      "page=1&perPage=2&filter=state%20!%3D%20'green'&sort=-key&fields=key&skipTotal=1",
    );
    const out = evaluatePbList(CONFORMANCE_ROWS, req);
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({
      page: 1,
      perPage: 2,
      // Non-green rows are e2e:acme/chat and d6:acme/chat; -key puts e2e first.
      items: [{ key: "e2e:acme/chat" }, { key: "d6:acme/chat" }],
    });
  });

  it("emits the COUNT envelope when skipTotal was NOT sent", () => {
    const req = parse("page=1&perPage=2&filter=dimension%20%3D%20'probe'");
    const body = JSON.parse(evaluatePbList(CONFORMANCE_ROWS, req).body);
    expect(body.totalItems).toBe(6);
    expect(body.totalPages).toBe(3);
    expect(body.items).toHaveLength(2);
  });

  it("omits the COUNT envelope when skipTotal WAS sent", () => {
    const req = parse("page=1&perPage=2&skipTotal=1");
    const body = JSON.parse(evaluatePbList(CONFORMANCE_ROWS, req).body);
    expect(body.totalItems).toBeUndefined();
    expect(body.totalPages).toBeUndefined();
  });

  it("returns a 400 CARRYING THE PARSE MESSAGE instead of throwing", () => {
    // The bug this replaces: `matchesPbFilter` was called bare inside a
    // createServer handler, so a parse error produced NO response at all — the
    // hook hung and the test died on a 20 s waitFor timeout with the parse
    // message nowhere in sight.
    const req = parse("filter=dimension%20%3D%20'smoke");
    const out = evaluatePbList(CONFORMANCE_ROWS, req);
    expect(out.status).toBe(400);
    expect(JSON.parse(out.body).message).toMatch(
      /unterminated single-quoted literal/,
    );
    expect(out.items).toBeUndefined();
  });

  it("400s rather than throwing for an unapplicable sort too", () => {
    const req = parse("sort=%40random");
    expect(evaluatePbList(CONFORMANCE_ROWS, req).status).toBe(400);
  });

  it("400s a malformed filter even against an EMPTY dataset", () => {
    // A leg that legitimately serves an empty page must not answer 200 for a
    // query the real server would reject — that is a silent pass on the one
    // query nobody was looking at.
    const req = parse("filter=dimension%20%3D%20'smoke&skipTotal=1");
    expect(evaluatePbList([], req).status).toBe(400);
    expect(evaluatePbList([], req, { alreadyPaged: true }).status).toBe(400);
    // A WELL-FORMED filter over no rows is still a clean empty 200.
    const ok = parse("filter=dimension%20%3D%20'smoke'&skipTotal=1");
    expect(evaluatePbList([], ok).status).toBe(200);
  });

  it("skips only the SLICE under alreadyPaged, still honouring filter/fields", () => {
    const page: PbRow[] = [
      { key: "a", state: "red", fail_count: 1 },
      { key: "b", state: "green", fail_count: 0 },
    ];
    const req = parse(
      "page=3&perPage=500&filter=state%20!%3D%20'green'&fields=key&skipTotal=1",
    );
    // Without alreadyPaged, page 3 of a 2-row dataset is empty.
    expect(JSON.parse(evaluatePbList(page, req).body).items).toEqual([]);
    // With it, the caller's synthesized page is served — but FILTERED.
    expect(
      JSON.parse(evaluatePbList(page, req, { alreadyPaged: true }).body).items,
    ).toEqual([{ key: "a" }]);
  });

  it("pbListBody reports the MATCHED total, not the page length", () => {
    const req = parse("page=1&perPage=2");
    expect(JSON.parse(pbListBody([{ key: "a" }], req, 37)).totalItems).toBe(37);
  });
});
