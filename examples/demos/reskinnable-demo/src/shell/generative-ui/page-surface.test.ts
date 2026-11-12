import { describe, expect, it } from "vitest";
import { pageSurfaceContent } from "./page-surface";

describe("pageSurfaceContent", () => {
  it("re-addresses every op to the page target, as A2UI 1.0", () => {
    const content = pageSurfaceContent(
      [
        {
          version: "v0.9",
          createSurface: { surfaceId: "spend-report-x1", catalogId: "cat" },
        },
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "spend-report-x1",
            components: [
              { id: "root", component: "Heading", text: { path: "/title" } },
            ],
          },
        },
      ],
      "canvas:banking",
    );

    expect(content).toEqual({
      surfaceId: "canvas:banking",
      target: "canvas:banking",
      catalogId: "cat",
      status: "ready",
      rejected: [],
      operations: [
        {
          version: "1.0",
          createSurface: { surfaceId: "canvas:banking", catalogId: "cat" },
        },
        {
          version: "1.0",
          updateComponents: {
            surfaceId: "canvas:banking",
            // A v0.9 `{ path }` binding becomes the 1.0 `{ "@path" }` form.
            components: [
              { id: "root", component: "Heading", text: { "@path": "/title" } },
            ],
          },
        },
      ],
    });
  });

  it("leaves the props of ops that are already A2UI 1.0 as they are", () => {
    const literal = { path: "/a" };
    const content = pageSurfaceContent(
      [
        {
          version: "1.0",
          updateComponents: {
            surfaceId: "block:b1",
            components: [{ id: "root", component: "Note", value: literal }],
          },
        },
      ],
      "inline:block:b1",
    );
    const op = content?.operations[0] as unknown as {
      updateComponents: { components: { value: unknown }[] };
    };
    expect(op.updateComponents.components[0].value).toEqual(literal);
  });

  it("returns null when no op names a surface", () => {
    expect(pageSurfaceContent([{ beginRendering: {} }], "canvas:x")).toBeNull();
    expect(pageSurfaceContent([], "canvas:x")).toBeNull();
  });
});
