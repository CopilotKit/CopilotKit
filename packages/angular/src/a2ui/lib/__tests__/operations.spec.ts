import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Catalog, MessageProcessor } from "@a2ui/web_core/v0_9";
import {
  applyA2UIOperations,
  DEFAULT_A2UI_SURFACE_ID,
  getA2UIMessageSurfaceId,
  normalizeA2UIOperations,
  toA2UIClientEventMessage,
} from "../operations";

const CATALOG_ID = "copilotkit://demo";

describe("normalizeA2UIOperations", () => {
  it("pins every created surface to the configured catalog", () => {
    const messages = normalizeA2UIOperations(
      [
        {
          createSurface: {
            surfaceId: "one",
            catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
            theme: { accent: "blue" },
          },
        },
        { beginRendering: { surfaceId: "two", styles: { accent: "red" } } },
      ],
      CATALOG_ID,
    );

    expect(messages).toEqual([
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "one",
          catalogId: CATALOG_ID,
          theme: { accent: "blue" },
          sendDataModel: undefined,
        },
      },
      {
        version: "v0.9",
        createSurface: {
          surfaceId: "two",
          catalogId: CATALOG_ID,
          theme: { accent: "red" },
          sendDataModel: undefined,
        },
      },
    ]);
  });

  it("normalizes legacy operation names and nested component shapes", () => {
    const messages = normalizeA2UIOperations(
      [
        {
          surfaceUpdate: {
            surfaceId: "s",
            components: [
              { id: "root", component: { Text: { text: "Nested" } } },
              { id: "flat", component: "Text", text: "Flat" },
            ],
          },
        },
        { dataModelUpdate: { surfaceId: "s", contents: { title: "T" } } },
        { surfaceId: "top", updateDataModel: { value: { a: 1 } } },
        { deleteSurface: { surfaceId: "s" } },
        "not an operation",
        { unknown: {} },
      ],
      CATALOG_ID,
    );

    expect(messages).toEqual([
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "s",
          components: [
            { id: "root", component: "Text", text: "Nested" },
            { id: "flat", component: "Text", text: "Flat" },
          ],
        },
      },
      {
        version: "v0.9",
        updateDataModel: { surfaceId: "s", path: "/", value: { title: "T" } },
      },
      {
        version: "v0.9",
        updateDataModel: { surfaceId: "top", path: "/", value: { a: 1 } },
      },
      { version: "v0.9", deleteSurface: { surfaceId: "s" } },
    ]);
  });

  it("resolves the surface id of a normalized message", () => {
    const [update, unknownMessage] = normalizeA2UIOperations(
      [{ updateComponents: { surfaceId: "dash", components: [] } }],
      CATALOG_ID,
    );
    expect(getA2UIMessageSurfaceId(update!)).toBe("dash");
    expect(unknownMessage).toBeUndefined();
    expect(getA2UIMessageSurfaceId({ version: "v0.9" } as never)).toBe(
      DEFAULT_A2UI_SURFACE_ID,
    );
  });
});

describe("toA2UIClientEventMessage", () => {
  it("maps a client action onto the userAction envelope", () => {
    expect(
      toA2UIClientEventMessage({
        name: "confirm",
        surfaceId: "dash",
        sourceComponentId: "button",
        context: { id: 1 },
        timestamp: "2026-01-01T00:00:00.000Z",
        dataContextPath: "/items/0",
      }),
    ).toEqual({
      userAction: {
        name: "confirm",
        surfaceId: "dash",
        sourceComponentId: "button",
        context: { id: 1 },
        timestamp: "2026-01-01T00:00:00.000Z",
        dataContextPath: "/items/0",
      },
    });
  });

  it("fills defaults for malformed actions", () => {
    const message = toA2UIClientEventMessage(null);
    expect(message.userAction?.name).toBe("unknown");
    expect(message.userAction?.surfaceId).toBe(DEFAULT_A2UI_SURFACE_ID);
    expect(message.userAction?.context).toEqual({});
    expect(typeof message.userAction?.timestamp).toBe("string");
  });
});

function text(surfaceId: string, value: string) {
  return {
    updateComponents: {
      surfaceId,
      components: [{ id: "root", component: "Text", text: value }],
    },
  };
}

function rootText(surface: {
  componentsModel: { get(id: string): unknown };
}): string {
  return (
    surface.componentsModel.get("root") as { properties: { text: string } }
  ).properties.text;
}

describe("applyA2UIOperations", () => {
  const catalog = new Catalog(CATALOG_ID, [
    { name: "Text", schema: z.object({ text: z.string() }) },
  ]);
  const processor = () => new MessageProcessor([catalog]);

  it("creates missing surfaces with the theme and skips creating existing ones", () => {
    const target = processor();
    const operations = [
      { createSurface: { surfaceId: "a", catalogId: "other" } },
      text("a", "created"),
      text("implicit", "no createSurface"),
    ];

    expect(
      applyA2UIOperations(target, operations, CATALOG_ID, {
        accent: "blue",
      }).map((surface) => surface.id),
    ).toEqual(["a", "implicit"]);
    expect(target.model.getSurface("implicit")?.theme).toEqual({
      accent: "blue",
    });

    // Replaying the same, grown list neither throws nor duplicates surfaces.
    const [a] = applyA2UIOperations(
      target,
      [...operations, text("a", "updated")],
      CATALOG_ID,
    );
    expect(rootText(a!)).toBe("updated");
  });

  it("recreates a surface that the replayed list deletes and creates again", () => {
    const target = processor();
    const created = [
      { createSurface: { surfaceId: "a", catalogId: CATALOG_ID } },
      text("a", "first"),
    ];
    applyA2UIOperations(target, created, CATALOG_ID);

    const surfaces = applyA2UIOperations(
      target,
      [
        ...created,
        { deleteSurface: { surfaceId: "a" } },
        { createSurface: { surfaceId: "a", catalogId: CATALOG_ID } },
        text("a", "second"),
      ],
      CATALOG_ID,
    );

    expect(surfaces).toHaveLength(1);
    expect(rootText(surfaces[0]!)).toBe("second");
  });

  it("drops deleted surfaces from the result", () => {
    const target = processor();
    expect(
      applyA2UIOperations(
        target,
        [text("a", "x"), { deleteSurface: { surfaceId: "a" } }],
        CATALOG_ID,
      ),
    ).toEqual([]);
  });

  it("keeps an explicit null data value", () => {
    const [message] = normalizeA2UIOperations(
      [{ updateDataModel: { surfaceId: "a", path: "/x", value: null } }],
      CATALOG_ID,
    );
    expect(message).toEqual({
      version: "v0.9",
      updateDataModel: { surfaceId: "a", path: "/x", value: null },
    });
  });
});
