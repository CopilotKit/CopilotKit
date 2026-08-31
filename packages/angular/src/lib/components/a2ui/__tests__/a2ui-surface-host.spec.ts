import { describe, expect, it, vi } from "vitest";

import {
  defineA2UIWebComponentsOnce,
  surfaceHasRenderableContent,
} from "../a2ui-surface-host";

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

  it("is inert when custom elements are unavailable during SSR", async () => {
    const customElements = globalThis.customElements;
    vi.stubGlobal("customElements", undefined);
    await expect(defineA2UIWebComponentsOnce()).resolves.toBeUndefined();
    vi.stubGlobal("customElements", customElements);
  });
});
