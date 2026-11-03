import { describe, expect, it } from "vitest";
import {
  getA2UIOperations,
  getA2UIOperationSurfaceId,
  groupA2UIOperationsBySurface,
  surfaceHasRenderableContent,
} from "../operations";

const text = { id: "root", component: "Text", text: "Hi" };
const boundList = {
  id: "root",
  component: "List",
  children: { path: "/items" },
};

describe("getA2UIOperations", () => {
  it("reads a2ui_operations and drops entries that are not objects", () => {
    const op = { createSurface: { surfaceId: "s" } };
    expect(
      getA2UIOperations({ a2ui_operations: [op, null, "x", [1]] }),
    ).toEqual([op]);
  });

  it("falls back to a bare operations key", () => {
    const op = { deleteSurface: { surfaceId: "s" } };
    expect(getA2UIOperations({ operations: [op] })).toEqual([op]);
  });

  it("returns an empty list for content without operations", () => {
    expect(getA2UIOperations({ status: "building" })).toEqual([]);
    expect(getA2UIOperations(undefined)).toEqual([]);
  });
});

describe("getA2UIOperationSurfaceId", () => {
  it("prefers the nested surfaceId over a top-level one (OSS-1048)", () => {
    expect(
      getA2UIOperationSurfaceId({
        surfaceId: "top",
        updateComponents: { surfaceId: "nested" },
      }),
    ).toBe("nested");
  });

  it("reads v0.8 keys", () => {
    expect(
      getA2UIOperationSurfaceId({ beginRendering: { surfaceId: "old" } }),
    ).toBe("old");
  });

  it("uses a top-level surfaceId when nothing is nested", () => {
    expect(getA2UIOperationSurfaceId({ surfaceId: "top" })).toBe("top");
  });

  it("returns null when the operation names no surface", () => {
    expect(getA2UIOperationSurfaceId({ updateComponents: {} })).toBeNull();
    expect(getA2UIOperationSurfaceId("nope")).toBeNull();
  });
});

describe("groupA2UIOperationsBySurface", () => {
  it("groups in first-seen order and files unnamed operations under default", () => {
    const a1 = { createSurface: { surfaceId: "a" } };
    const b1 = { createSurface: { surfaceId: "b" } };
    const a2 = { updateComponents: { surfaceId: "a" } };
    const anon = { version: "v0.9" };
    expect([...groupA2UIOperationsBySurface([a1, b1, anon, a2])]).toEqual([
      ["a", [a1, a2]],
      ["b", [b1]],
      ["default", [anon]],
    ]);
  });
});

describe("surfaceHasRenderableContent", () => {
  it("is false without component operations", () => {
    expect(
      surfaceHasRenderableContent([{ createSurface: { surfaceId: "s" } }]),
    ).toBe(false);
  });

  it("is true for static components alone", () => {
    expect(
      surfaceHasRenderableContent([
        { updateComponents: { surfaceId: "s", components: [text] } },
      ]),
    ).toBe(true);
  });

  it("waits for a non-empty data model when components bind by path", () => {
    const components = {
      updateComponents: { surfaceId: "s", components: [boundList] },
    };
    expect(surfaceHasRenderableContent([components])).toBe(false);
    expect(
      surfaceHasRenderableContent([
        components,
        {
          updateDataModel: { surfaceId: "s", value: { items: [], title: "" } },
        },
      ]),
    ).toBe(false);
    expect(
      surfaceHasRenderableContent([
        components,
        { updateDataModel: { surfaceId: "s", value: { items: [1] } } },
      ]),
    ).toBe(true);
  });
});
