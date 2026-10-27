import { EventType } from "@ag-ui/client";
import type { ActivityDeltaEvent, BaseEvent } from "@ag-ui/client";
import { expect, test } from "vitest";
import { createSurfaceWriter } from "../generative-ui";

function isDelta(event: BaseEvent): event is ActivityDeltaEvent {
  return event.type === EventType.ACTIVITY_DELTA;
}

test("openSurface emits a snapshot, then one delta per call, then ready", () => {
  const events: BaseEvent[] = [];
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
          version: "v1.0",
          createSurface: { surfaceId: "recs", catalogId: "shop" },
        },
      ],
      status: "streaming",
    },
  });
  const deltas = events.slice(1);
  expect(deltas.every(isDelta)).toBe(true);
  expect(deltas.filter(isDelta).map((e) => e.patch)).toEqual([
    [
      {
        op: "add",
        path: "/operations/-",
        value: {
          version: "v1.0",
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
          version: "v1.0",
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
          version: "v1.0",
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
