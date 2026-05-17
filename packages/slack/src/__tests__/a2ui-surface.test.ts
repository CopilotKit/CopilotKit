import { describe, it, expect } from "vitest";
import {
  applyA2UIOperations,
  type A2UIOperation,
} from "../a2ui/surface-state.js";

const CAT = "copilotkit://test-catalog";

describe("applyA2UIOperations", () => {
  it("creates an empty surface on createSurface", () => {
    const ops: A2UIOperation[] = [
      { createSurface: { surfaceId: "s1", catalogId: CAT } },
    ];
    const s = applyA2UIOperations(ops);
    expect(s.size).toBe(1);
    const surface = s.get("s1")!;
    expect(surface.catalogId).toBe(CAT);
    expect(surface.components.size).toBe(0);
    expect(surface.dataModel).toEqual({});
  });

  it("populates components on updateComponents", () => {
    const s = applyA2UIOperations([
      { createSurface: { surfaceId: "s1", catalogId: CAT } },
      {
        updateComponents: {
          surfaceId: "s1",
          components: [
            { id: "root", component: "Title", text: "Hello" },
            { id: "child", component: "Text", text: "World" },
          ],
        },
      },
    ]);
    const surface = s.get("s1")!;
    expect(surface.components.size).toBe(2);
    expect(surface.components.get("root")?.component).toBe("Title");
    expect(surface.components.get("child")?.component).toBe("Text");
  });

  it("ignores updateComponents for unknown surface", () => {
    const s = applyA2UIOperations([
      {
        updateComponents: {
          surfaceId: "ghost",
          components: [{ id: "root", component: "Title" }],
        },
      },
    ]);
    expect(s.size).toBe(0);
  });

  it("whole-replaces dataModel when path is omitted", () => {
    const s = applyA2UIOperations([
      { createSurface: { surfaceId: "s1", catalogId: CAT } },
      {
        updateDataModel: {
          surfaceId: "s1",
          value: { flights: [{ airline: "United" }] },
        },
      },
    ]);
    expect(s.get("s1")?.dataModel).toEqual({
      flights: [{ airline: "United" }],
    });
  });

  it("accepts `data` as an alias for `value`", () => {
    const s = applyA2UIOperations([
      { createSurface: { surfaceId: "s1", catalogId: CAT } },
      { updateDataModel: { surfaceId: "s1", data: { x: 1 } } },
    ]);
    expect(s.get("s1")?.dataModel).toEqual({ x: 1 });
  });

  it("sets value at a dotted path inside dataModel", () => {
    const s = applyA2UIOperations([
      { createSurface: { surfaceId: "s1", catalogId: CAT } },
      {
        updateDataModel: { surfaceId: "s1", value: { user: { name: "a" } } },
      },
      { updateDataModel: { surfaceId: "s1", path: "user.name", value: "b" } },
    ]);
    expect(s.get("s1")?.dataModel).toEqual({ user: { name: "b" } });
  });

  it("deleteSurface removes the surface", () => {
    const s = applyA2UIOperations([
      { createSurface: { surfaceId: "s1", catalogId: CAT } },
      { deleteSurface: { surfaceId: "s1" } },
    ]);
    expect(s.has("s1")).toBe(false);
  });

  it("re-creating a surface resets components and dataModel", () => {
    const s = applyA2UIOperations([
      { createSurface: { surfaceId: "s1", catalogId: CAT } },
      {
        updateComponents: {
          surfaceId: "s1",
          components: [{ id: "root", component: "Title" }],
        },
      },
      { updateDataModel: { surfaceId: "s1", value: { x: 1 } } },
      { createSurface: { surfaceId: "s1", catalogId: CAT } },
    ]);
    const surface = s.get("s1")!;
    expect(surface.components.size).toBe(0);
    expect(surface.dataModel).toEqual({});
  });
});
