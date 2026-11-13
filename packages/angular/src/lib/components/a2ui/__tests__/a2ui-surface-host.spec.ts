import { describe, expect, it } from "vitest";

import { surfaceHasRenderableContent } from "../a2ui-surface-host";

describe("surfaceHasRenderableContent", () => {
  it("accepts static components and waits for populated data-bound surfaces", () => {
    expect(
      surfaceHasRenderableContent([
        {
          updateComponents: {
            surfaceId: "static",
            components: [{ id: "root", component: "Text", text: "Ready" }],
          },
        },
      ]),
    ).toBe(true);

    const boundComponents = {
      updateComponents: {
        surfaceId: "bound",
        components: [
          { id: "root", component: "List", children: { path: "/items" } },
        ],
      },
    };
    expect(surfaceHasRenderableContent([boundComponents])).toBe(false);
    expect(
      surfaceHasRenderableContent([
        boundComponents,
        {
          updateDataModel: {
            surfaceId: "bound",
            path: "/",
            value: { items: [{ name: "Ready" }] },
          },
        },
      ]),
    ).toBe(true);
  });
});
