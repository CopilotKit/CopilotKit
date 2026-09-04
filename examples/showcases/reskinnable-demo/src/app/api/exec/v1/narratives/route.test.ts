import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "./route";
import * as store from "@/skins/exec/data/store";
import type { Narrative } from "@/skins/exec/data/types";

beforeEach(() => store.reset());

const VALID_BODY = {
  metricId: "opex",
  period: "2024-06",
  code: "VAR-TIMING",
  body: "Shipment timing shift pushed the spend into this period.",
  source: "typed",
};

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
    const res = await file({ ...VALID_BODY, code: "VAR-NOPE" });
    expect(res.status).toBe(400);
    const text = JSON.stringify(await res.json());
    // The rejected value itself has to show up in the body: a swallowed
    // default ("Bad request", no detail) would give the agent nothing to
    // retry against and would be indistinguishable from any other 400.
    expect(text).toContain("VAR-NOPE");
  });

  it("refuses a made-up code with the same codeless BAD_CODE contract the agent tool uses", async () => {
    const res = await file({ ...VALID_BODY, code: "VAR-NOPE" });
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
      const res = await file({ ...VALID_BODY, ...patch });
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
    const res = await file({ ...VALID_BODY, code: "  VAR-TIMING  " });
    expect(res.status).toBe(201);
    const narrative: Narrative = await res.json();
    // Trimming mirrors the agent tool's own trim: a code pasted out of a memo
    // carries whitespace, and refusing it teaches nobody anything.
    expect(narrative.code).toBe("VAR-TIMING");
    expect(store.snapshot().narratives).toContainEqual(narrative);
  });

  it("400s a malformed period instead of filing a narrative that clears no breach", async () => {
    const res = await file({ ...VALID_BODY, period: "2024-6" });
    expect(res.status).toBe(400);
    expect(store.snapshot().narratives).toHaveLength(0);
  });

  it("400s an unknown metricId instead of filing against a metric the ledger has no series for", async () => {
    const res = await file({ ...VALID_BODY, metricId: "notAMetric" });
    expect(res.status).toBe(400);
    expect(store.snapshot().narratives).toHaveLength(0);
  });

  it("400s an empty body instead of flipping `explained` on nothing", async () => {
    const res = await file({ ...VALID_BODY, body: "   " });
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
    const withoutSource: Partial<typeof VALID_BODY> = { ...VALID_BODY };
    delete withoutSource.source;
    const res = await file(withoutSource);
    expect(res.status).toBe(201);
    const narrative: Narrative = await res.json();
    // Provenance is a board-pack-visible field, so the default has to be the
    // conservative one — an omitted source is a typed narrative, never an
    // ingested memo the operator never attached.
    expect(narrative.source).toBe("typed");
  });

  it("201s a valid code and the store now holds the filed narrative", async () => {
    const res = await file(VALID_BODY);
    expect(res.status).toBe(201);
    const narrative: Narrative = await res.json();
    expect(narrative).toMatchObject({
      metricId: VALID_BODY.metricId,
      period: VALID_BODY.period,
      code: VALID_BODY.code,
      body: VALID_BODY.body,
      source: VALID_BODY.source,
    });
    expect(narrative.id).toBeTruthy();
    expect(narrative.filedAt).toBeTruthy();

    expect(store.snapshot().narratives).toContainEqual(narrative);
  });
});
