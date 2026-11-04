import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/exec/data/store";
import { fileVarianceNarrativeTool } from "@/skins/exec/agent";
import type { MetricId, Narrative } from "@/skins/exec/data/types";

beforeEach(() => store.reset());

/**
 * A period the ledger ACTUALLY holds a row for, read back rather than written
 * down. The seed builds the 24 months ending at the latest CLOSED period and
 * re-derives them on every `reset()` (see store.ts's module comment), so a
 * literal period here is a period that silently rots out of the window as the
 * calendar moves — which is exactly the input the route now refuses.
 */
const livePeriod = (metricId: MetricId = "opex"): string => {
  const period = store.metricSeries({ metricId }).at(-1)?.period;
  if (!period) throw new Error(`the seed holds no ${metricId} points`);
  return period;
};

/** A filing that must succeed: live period, accepted code, non-empty body. */
const validBody = () => ({
  metricId: "opex" as MetricId,
  period: livePeriod(),
  code: "VAR-TIMING",
  body: "Shipment timing shift pushed the spend into this period.",
  source: "typed",
});

const file = (body: unknown) =>
  POST(
    new Request("http://localhost/api/exec/v1/narratives", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );

// The four codes the board-packs filing form withholds from every agent
// channel (see agent.ts's `isNarrativeCode` doc comment). The withheld-
// vocabulary design is defeated the moment ANY of these literals rides back
// in a 400 body — an agent probing this route with a bad code would read
// the whole catalogue off the error.
const WITHHELD_CODES = ["VAR-TIMING", "VAR-ONEOFF", "VAR-FX", "VAR-PLAN"];

describe("POST /api/exec/v1/narratives", () => {
  it("400s a made-up code — the rejected value reaches the body, not a swallowed default", async () => {
    const res = await file({ ...validBody(), code: "VAR-NOPE" });
    expect(res.status).toBe(400);
    const text = JSON.stringify(await res.json());
    // The rejected value itself has to show up in the body: a swallowed
    // default ("Bad request", no detail) would give the agent nothing to
    // retry against and would be indistinguishable from any other 400.
    expect(text).toContain("VAR-NOPE");
  });

  it("refuses a made-up code with the same codeless BAD_CODE contract the agent tool uses", async () => {
    const res = await file({ ...validBody(), code: "VAR-NOPE" });
    expect(res.status).toBe(400);
    const body = await res.json();
    // Same shape and same story as `agent.ts`'s `isNarrativeCode` arm: the
    // two layers must not disagree about what a bad code means, and neither
    // may answer with a zod issue list whose message is written by zod.
    expect(body.error).toBe("BAD_CODE");
    expect(body.message).toContain(
      '"VAR-NOPE" is not a code this ledger files under',
    );
    expect(body.message).toContain("ask the operator");
    // A zod issue array would reintroduce zod-authored prose into the one
    // refusal that must stay hand-written.
    expect(body.issues).toBeUndefined();
    expect(store.snapshot().narratives).toHaveLength(0);
  });

  // The leak check has to read the ENTIRE raw response body, not a hand-picked
  // field: zod's `invalid_enum_value` puts the option list in the issue
  // `message` string as well as in `options`, so any assertion narrower than
  // "the whole payload contains none of these literals" can pass while the
  // catalogue is being published one field over.
  it.each([
    ["a made-up code", { code: "VAR-NOPE" }],
    ["an empty code", { code: "" }],
    ["a whitespace-only code", { code: "   " }],
    ["a non-string code", { code: 7 }],
    ["a missing code", { code: undefined }],
    ["a lowercased near-miss", { code: "var-timing" }],
  ])(
    "rejects %s without leaking the withheld catalogue anywhere in the body",
    async (_label, patch) => {
      const res = await file({ ...validBody(), ...patch });
      expect([400, 422]).toContain(res.status);
      const raw = await res.text();
      for (const withheld of WITHHELD_CODES) {
        expect(
          raw,
          `response body leaked withheld code "${withheld}" — zod's enum error (or an equivalent) is publishing the catalogue`,
        ).not.toContain(withheld);
      }
      expect(store.snapshot().narratives).toHaveLength(0);
    },
  );

  it("accepts a code with stray surrounding whitespace and files it trimmed", async () => {
    const res = await file({ ...validBody(), code: "  VAR-TIMING  " });
    expect(res.status).toBe(201);
    const narrative: Narrative = await res.json();
    // Trimming mirrors the agent tool's own trim: a code pasted out of a memo
    // carries whitespace, and refusing it teaches nobody anything.
    expect(narrative.code).toBe("VAR-TIMING");
    expect(store.snapshot().narratives).toContainEqual(narrative);
  });

  it("400s a malformed period instead of filing a narrative that clears no breach", async () => {
    const res = await file({ ...validBody(), period: "2024-6" });
    expect(res.status).toBe(400);
    expect(store.snapshot().narratives).toHaveLength(0);
  });

  it("400s an unknown metricId instead of filing against a metric the ledger has no series for", async () => {
    const res = await file({ ...validBody(), metricId: "notAMetric" });
    expect(res.status).toBe(400);
    expect(store.snapshot().narratives).toHaveLength(0);
  });

  it("400s an empty body instead of flipping `explained` on nothing", async () => {
    const res = await file({ ...validBody(), body: "   " });
    expect(res.status).toBe(400);
    expect(store.snapshot().narratives).toHaveLength(0);
  });

  it("400s a malformed payload (not an object) instead of throwing", async () => {
    const res = await POST(
      new Request("http://localhost/api/exec/v1/narratives", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
    expect(store.snapshot().narratives).toHaveLength(0);
  });

  it('defaults `source` to "typed" when the filing omits it', async () => {
    const withoutSource: Partial<ReturnType<typeof validBody>> = {
      ...validBody(),
    };
    delete withoutSource.source;
    const res = await file(withoutSource);
    expect(res.status).toBe(201);
    const narrative: Narrative = await res.json();
    // Provenance is a board-pack-visible field, so the default has to be the
    // conservative one — an omitted source is a typed narrative, never an
    // ingested memo the operator never attached.
    expect(narrative.source).toBe("typed");
  });

  it('files `source: "ingested-memo"` verbatim rather than collapsing it to the default', async () => {
    // Beat 3d's path: the operator attaches the budget memo and the
    // explanation is read out of it. `defaults`, `.catch()` or a stray
    // overwrite of `source` would silently relabel an ingested filing as
    // typed, and the board pack would then misreport where it came from.
    const res = await file({ ...validBody(), source: "ingested-memo" });
    expect(res.status).toBe(201);
    const narrative: Narrative = await res.json();
    expect(narrative.source).toBe("ingested-memo");
    expect(store.snapshot().narratives[0].source).toBe("ingested-memo");
  });

  it("201s a valid code and the store now holds the filed narrative", async () => {
    const payload = validBody();
    const res = await file(payload);
    expect(res.status).toBe(201);
    const narrative: Narrative = await res.json();
    expect(narrative).toMatchObject({
      metricId: payload.metricId,
      period: payload.period,
      code: payload.code,
      body: payload.body,
      source: payload.source,
    });
    expect(narrative.id).toBeTruthy();
    expect(narrative.filedAt).toBeTruthy();

    expect(store.snapshot().narratives).toContainEqual(narrative);
  });
});

/**
 * THE (metricId, period) HAS TO NAME A ROW THIS LEDGER HOLDS.
 *
 * `agent.ts`'s `fileVarianceNarrativeTool` already refuses this with
 * `NO_LEDGER_POINT`, but beat 6's filing form POSTs HERE, and its metric and
 * period `<select>`s are not constrained to the pairs the ledger actually
 * covers — so a form filing (or an agent probing the endpoint directly rather
 * than through the tool) reached `store.fileNarrative` unchecked, got a 201
 * that said "filed", and appended a narrative matching nothing. `exceptions()`
 * pairs a narrative to a breach by EXACT (metricId, period), so the breach
 * stayed unexplained and the publish gate went on refusing while the filing
 * form showed success.
 */
describe("POST /api/exec/v1/narratives — the row has to exist", () => {
  it("422s NO_LEDGER_POINT for a shape-valid period the ledger holds no row for, and files nothing", async () => {
    const res = await file({ ...validBody(), period: "1999-01" });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("NO_LEDGER_POINT");
    // Names the metric and the period it could not find, so the operator (or
    // the agent) can tell a typo from a broken route.
    expect(body.message).toContain("opex");
    expect(body.message).toContain("1999-01");
    expect(store.snapshot().narratives).toHaveLength(0);
  });

  /**
   * WORD FOR WORD the tool's refusal, asserted by running both layers rather
   * than by copying the string — the same mechanical mirror the BAD_CODE
   * contract above relies on. A hand-copied message drifts on the first edit
   * to either side, and then the REST layer and the tool layer tell the
   * operator's agent two different stories about the same rejected filing.
   */
  it("refuses with the same NO_LEDGER_POINT message the agent tool returns", async () => {
    const args = { ...validBody(), period: "1999-01" };

    const res = await file(args);
    const routeBody = await res.json();

    const toolResult = (await fileVarianceNarrativeTool.execute!({
      metricId: args.metricId,
      period: args.period,
      code: args.code,
      body: args.body,
    })) as { error?: string; message?: string };

    expect(routeBody.error).toBe(toolResult.error);
    expect(routeBody.message).toBe(toolResult.message);
    expect(store.snapshot().narratives).toHaveLength(0);
  });

  it("still files against a period the ledger DOES hold, so the guard is not simply refusing everything", async () => {
    const res = await file(validBody());
    expect(res.status).toBe(201);
    expect(store.snapshot().narratives).toHaveLength(1);
  });
});

/**
 * `code` and `body` are free strings by design (see the route's doc comment on
 * why `code` may never be a zod enum), which left them with NO bounds at all:
 * a whitespace-only code trimmed to `""` and came back as the confusing
 * `"" is not a code this ledger files under`, and a megabyte of text in either
 * field was filed verbatim into a demo store that never evicts.
 */
describe("POST /api/exec/v1/narratives — length bounds", () => {
  it("refuses a whitespace-only code as an EMPTY code, not as a nameless bad one", async () => {
    const res = await file({ ...validBody(), code: "   " });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("BAD_REQUEST");
    // The refusal has to say the field was blank. `"" is not a code this
    // ledger files under` names nothing and reads as though the caller sent
    // some other code the ledger rejected.
    expect(JSON.stringify(body)).toMatch(/code cannot be empty/i);
    expect(JSON.stringify(body)).not.toContain(
      '"" is not a code this ledger files under',
    );
    expect(store.snapshot().narratives).toHaveLength(0);
  });

  it.each([
    ["code", "x".repeat(1_000)],
    ["body", "x".repeat(100_000)],
  ])("400s an unbounded %s rather than filing it", async (field, value) => {
    const res = await file({ ...validBody(), [field]: value });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("BAD_REQUEST");
    expect(store.snapshot().narratives).toHaveLength(0);
  });

  it("still accepts a long-but-reasonable narrative body", async () => {
    // The bound must sit well clear of a real explanation — beat 6's body is
    // a paragraph read out of the budget memo, not a tweet.
    const res = await file({ ...validBody(), body: "x".repeat(2_000) });
    expect(res.status).toBe(201);
  });
});
