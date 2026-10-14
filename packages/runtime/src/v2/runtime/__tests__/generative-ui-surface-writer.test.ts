import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { expect, test } from "vitest";
import { createSurfaceWriter } from "../generative-ui";

test("openSurface emits a snapshot, then one delta per call, then ready", () => {
  const events: any[] = [];
  const ui = createSurfaceWriter((e: BaseEvent) => events.push(e));
  const surface = ui.openSurface({
    target: "recommendations",
    surfaceId: "recs",
    catalog: "shop",
  });
  surface.setRoot({ component: "ProductGrid", children: ["a"] });
  surface.upsert({
    id: "a",
    component: "ProductCard",
    name: "Headphones",
    price: 149,
  });
  surface.updateData("/products/a/price", 129);
  surface.close();

  expect(events[0]).toMatchObject({
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: "genui:recs",
    content: {
      target: "recommendations",
      catalogId: "shop",
      operations: [
        {
          version: "v0.9",
          createSurface: { surfaceId: "recs", catalogId: "shop" },
        },
      ],
      status: "streaming",
    },
  });
  expect(events.slice(1).map((e) => e.patch)).toEqual([
    [
      {
        op: "add",
        path: "/operations/-",
        value: {
          version: "v0.9",
          updateComponents: {
            surfaceId: "recs",
            components: [
              { id: "root", component: "ProductGrid", children: ["a"] },
            ],
          },
        },
      },
    ],
    [
      {
        op: "add",
        path: "/operations/-",
        value: {
          version: "v0.9",
          updateComponents: {
            surfaceId: "recs",
            components: [
              {
                id: "a",
                component: "ProductCard",
                name: "Headphones",
                price: 149,
              },
            ],
          },
        },
      },
    ],
    [
      {
        op: "add",
        path: "/operations/-",
        value: {
          version: "v0.9",
          updateDataModel: {
            surfaceId: "recs",
            path: "/products/a/price",
            value: 129,
          },
        },
      },
    ],
    [{ op: "replace", path: "/status", value: "ready" }],
  ]);
});
