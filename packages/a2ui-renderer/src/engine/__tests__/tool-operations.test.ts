import { describe, expect, it } from "vitest";
import {
  getRenderedA2UIToolOperations,
  operationsFromA2UISnapshot,
} from "../tool-operations";
import { A2UI_BASIC_CATALOG_ID } from "../../catalog-ids";

const snapshot = {
  surfaceId: "s",
  components: [{ id: "root", component: "Text", text: "Hi" }],
  data: { n: 1 },
};
const snapshotOperations = [
  {
    version: "v0.9",
    createSurface: {
      surfaceId: "s",
      catalogId: A2UI_BASIC_CATALOG_ID,
      theme: {},
    },
  },
  {
    version: "v0.9",
    updateDataModel: { surfaceId: "s", path: "/", value: { n: 1 } },
  },
  {
    version: "v0.9",
    updateComponents: { surfaceId: "s", components: snapshot.components },
  },
];

describe("operationsFromA2UISnapshot", () => {
  it("prefers a2ui_operations", () => {
    const op = { createSurface: { surfaceId: "x" } };
    expect(
      operationsFromA2UISnapshot({ a2ui_operations: [op], ...snapshot }),
    ).toEqual([op]);
  });

  it("turns a bare or nested snapshot into operations", () => {
    expect(operationsFromA2UISnapshot(snapshot)).toEqual(snapshotOperations);
    expect(operationsFromA2UISnapshot({ snapshot })).toEqual(
      snapshotOperations,
    );
  });

  it("returns nothing for a payload that is neither", () => {
    expect(operationsFromA2UISnapshot({ surfaceId: "s" })).toEqual([]);
  });
});

describe("getRenderedA2UIToolOperations", () => {
  it("reads operations from the JSON result first", () => {
    expect(
      getRenderedA2UIToolOperations({
        name: "render_a2ui",
        status: "complete",
        args: {},
        result: JSON.stringify(snapshot),
      }),
    ).toEqual(snapshotOperations);
  });

  it("waits for a state snapshot call to complete", () => {
    const call = { name: "AGUISendStateSnapshot", args: snapshot };
    expect(
      getRenderedA2UIToolOperations({ ...call, status: "inProgress" }),
    ).toEqual([]);
    expect(
      getRenderedA2UIToolOperations({ ...call, status: "complete" }),
    ).toEqual(snapshotOperations);
  });
});
