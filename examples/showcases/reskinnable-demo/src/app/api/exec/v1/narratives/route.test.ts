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

  it("400s a made-up code WITHOUT leaking the withheld catalogue — the actual valid codes must never appear", async () => {
    const res = await file({ ...VALID_BODY, code: "VAR-NOPE" });
    expect(res.status).toBe(400);
    const text = JSON.stringify(await res.json());
    for (const validCode of WITHHELD_CODES) {
      expect(
        text,
        `400 body leaked withheld code "${validCode}" — zod's enum error (or an equivalent) is publishing the catalogue`,
      ).not.toContain(validCode);
    }
  });

  it("400s a malformed period instead of filing a narrative that clears no breach", async () => {
    const res = await file({ ...VALID_BODY, period: "2024-6" });
    expect(res.status).toBe(400);
    expect(store.snapshot().narratives).toHaveLength(0);
  });

  it("400s an empty body instead of flipping `explained` on nothing", async () => {
    const res = await file({ ...VALID_BODY, body: "   " });
    expect(res.status).toBe(400);
    expect(store.snapshot().narratives).toHaveLength(0);
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
