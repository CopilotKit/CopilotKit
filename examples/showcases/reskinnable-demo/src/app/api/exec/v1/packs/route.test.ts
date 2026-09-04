import { beforeEach, describe, expect, it } from "vitest";
import * as store from "@/skins/exec/data/store";
import { POST } from "./route";

beforeEach(() => store.reset());

const post = (body: unknown) =>
  POST(
    new Request("http://t/api/exec/v1/packs", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

/**
 * Mirrors `store.test.ts`'s publish arm: a breach clears only when a narrative
 * exists for its exact `(metricId, period)` pair, so the success case has to
 * file one per unexplained exception rather than a single blanket narrative.
 */
const explainEveryBreach = () => {
  const filed = store
    .exceptions()
    .filter((e) => !e.explained)
    .map((e) =>
      store.fileNarrative({
        metricId: e.metricId,
        period: e.period,
        code: "VAR-TIMING",
        body: "Shipment timing shift into the next month.",
        source: "typed",
      }),
    );
  expect(
    filed.length,
    "seed no longer carries unexplained breaches",
  ).toBeGreaterThan(0);
  return filed;
};

describe("POST /api/exec/v1/packs", () => {
  it("publishes a pack once every breach is explained (200 with the pack)", async () => {
    const filed = explainEveryBreach();

    const res = await post({
      dashboardId: "cfo",
      countersignPin: store.COUNTERSIGN_PIN,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ dashboardId: "cfo" });
    expect(typeof body.id).toBe("string");
    expect(typeof body.publishedAt).toBe("string");
    // The published pack pins the dashboard's blocks and the narratives that
    // cleared its gate — an empty pack would still be a 200, so both lists
    // are asserted non-empty against the store's own view.
    expect(body.blockIds).toEqual(
      store.snapshot().dashboards.cfo.blocks.map((b) => b.id),
    );
    expect(body.blockIds.length).toBeGreaterThan(0);
    expect(body.narrativeIds.length).toBeGreaterThan(0);
    for (const id of body.narrativeIds) {
      expect(filed.map((n) => n.id)).toContain(id);
    }
    // ...and it is recorded, not just returned.
    expect(store.snapshot().packs.map((p) => p.id)).toContain(body.id);
  });

  it("POST packs surfaces the gate as 422 UNEXPLAINED_VARIANCE", async () => {
    const res = await POST(
      new Request("http://t/api/exec/v1/packs", {
        method: "POST",
        body: JSON.stringify({
          dashboardId: "cfo",
          countersignPin: store.COUNTERSIGN_PIN,
        }),
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("UNEXPLAINED_VARIANCE");
    expect(body.breaches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricId: "opex",
          department: "distribution",
        }),
      ]),
    );
  });

  it("refuses a wrong countersign PIN before checking variance (403 BAD_COUNTERSIGN)", async () => {
    const res = await POST(
      new Request("http://t/api/exec/v1/packs", {
        method: "POST",
        body: JSON.stringify({
          dashboardId: "cfo",
          countersignPin: "0000",
        }),
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("BAD_COUNTERSIGN");
  });

  /**
   * The PIN gate runs FIRST so a bad countersign learns nothing about variance
   * state (see `store.publishPack`'s ordering comment). Asserting only
   * `error === "BAD_COUNTERSIGN"` leaves that leak untested: a 403 that also
   * carried `breaches` would still pass. This asserts the refusal is bare —
   * no `breaches` key, and no breaching metric/department/period string
   * anywhere in the RAW body text, so a leak smuggled under a different key
   * name is caught too.
   */
  it("leaks no variance state in the 403 body", async () => {
    const withheld = store.exceptions().filter((e) => !e.explained);
    expect(
      withheld.length,
      "seed no longer carries unexplained breaches",
    ).toBeGreaterThan(0);

    const res = await post({ dashboardId: "cfo", countersignPin: "0000" });
    expect(res.status).toBe(403);
    const text = await res.text();
    const body = JSON.parse(text);

    expect(Object.keys(body)).toEqual(["error"]);
    expect(body).not.toHaveProperty("breaches");
    expect(text).not.toContain("breaches");
    for (const breach of withheld) {
      expect(text).not.toContain(breach.metricId);
      expect(text).not.toContain(breach.period);
      expect(text).not.toContain(breach.department);
    }
    // The withheld secret itself never travels back either.
    expect(text).not.toContain(store.COUNTERSIGN_PIN);
  });

  it("rejects a malformed payload with 400 before reaching the store", async () => {
    const cases: unknown[] = [
      "not json at all",
      {},
      { dashboardId: "cfo" },
      { countersignPin: store.COUNTERSIGN_PIN },
      { dashboardId: "marketing", countersignPin: store.COUNTERSIGN_PIN },
      { dashboardId: "cfo", countersignPin: 7341 },
    ];
    for (const payload of cases) {
      const res = await post(payload);
      expect(res.status, JSON.stringify(payload)).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("BAD_REQUEST");
      expect(Array.isArray(body.issues)).toBe(true);
    }
    // A refused payload must not have published anything.
    expect(store.snapshot().packs).toHaveLength(0);
  });
});
