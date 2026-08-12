import { describe, expect, it } from "vitest";
import {
  A2UI_OPERATIONS_KEY,
  buildTripBriefOps,
  extractSurfaceId,
  readBriefId,
  TRIP_BRIEF_CATALOG_ID,
  TRIP_BRIEF_ID_PATH,
  TRIP_BRIEF_SURFACE_ID,
} from "./trip-brief-ops";

/**
 * The trigger contract between a later slot's `render_trip_brief` tool and
 * `AirlineCanvasSurface`. Everything here fails SILENTLY when wrong: a mistyped
 * operations key means the middleware never emits an `a2ui-surface` activity and
 * the canvas simply never opens, with nothing in the log to say why.
 */

describe("buildTripBriefOps", () => {
  it("emits the key the a2ui middleware detects, and a resolvable surface", () => {
    // Written out rather than imported: a test that imports the constant it
    // checks cannot notice the constant changing, and this one is the difference
    // between a canvas that opens and one that never does.
    expect(A2UI_OPERATIONS_KEY).toBe("a2ui_operations");

    const ops = buildTripBriefOps("tb-1");
    expect(extractSurfaceId(ops)).toBe(TRIP_BRIEF_SURFACE_ID);
    expect(ops[0]).toMatchObject({
      version: "v0.9",
      createSurface: {
        surfaceId: TRIP_BRIEF_SURFACE_ID,
        catalogId: TRIP_BRIEF_CATALOG_ID,
      },
    });
  });

  it("carries the brief id, and nothing else", () => {
    // Data does not travel in the ops: the canvas reads the FILED brief back off
    // the app, so what the room sees survives deleting the conversation.
    const ops = buildTripBriefOps("tb-abc");
    expect(readBriefId(ops)).toBe("tb-abc");
    expect(JSON.stringify(ops)).not.toContain("Casa Miraflores");
  });

  it("writes NO data-model op at all when no brief is named", () => {
    // An explicit null in the model reads as "this surface is about no brief",
    // which is a different claim from "the surface did not say". The surface
    // treats the absence as "show the newest".
    for (const blank of [undefined, null, "", "   "]) {
      const ops = buildTripBriefOps(blank);
      expect(ops).toHaveLength(1);
      expect(readBriefId(ops)).toBeNull();
    }
  });

  it("honours an explicit surfaceId", () => {
    const ops = buildTripBriefOps("tb-1", "other-surface");
    expect(extractSurfaceId(ops)).toBe("other-surface");
  });
});

describe("readBriefId", () => {
  it("reads the id this file writes", () => {
    expect(
      readBriefId([
        {
          updateDataModel: {
            surfaceId: "s",
            path: TRIP_BRIEF_ID_PATH,
            value: "tb-9",
          },
        },
      ]),
    ).toBe("tb-9");
  });

  it("also reads it off a component, so a richer later surface still works", () => {
    // Deliberate tolerance: a later slot that builds a full component tree does
    // not have to come back here to make the canvas resolve the right brief.
    expect(
      readBriefId([
        { createSurface: { surfaceId: "s" } },
        {
          updateComponents: {
            surfaceId: "s",
            components: [
              { id: "root", component: "Stack" },
              { id: "brief", component: "TripBrief", briefId: "tb-7" },
            ],
          },
        },
      ]),
    ).toBe("tb-7");
  });

  it("returns null — never a partial guess — on anything it cannot read", () => {
    expect(readBriefId([])).toBeNull();
    expect(
      readBriefId([{ updateDataModel: { path: "/other", value: "x" } }]),
    ).toBeNull();
    expect(
      readBriefId([
        { updateDataModel: { path: TRIP_BRIEF_ID_PATH, value: 42 } },
      ]),
    ).toBeNull();
  });
});

describe("extractSurfaceId", () => {
  it("returns null on an empty op list rather than a made-up id", () => {
    expect(extractSurfaceId([])).toBeNull();
    expect(extractSurfaceId([{ version: "v0.9" }])).toBeNull();
  });
});
