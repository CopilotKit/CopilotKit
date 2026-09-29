import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Catalog, MessageProcessor } from "@a2ui/web_core/v0_9";
import { applyA2UIOperations, normalizeA2UIOperations } from "../operations";

const CATALOG_ID = "copilotkit://demo";

describe("normalizeA2UIOperations", () => {
  it("pins created surfaces to the catalog and reads a missing version as v0.9", () => {
    const messages = normalizeA2UIOperations(
      [
        {
          version: "v0.9",
          createSurface: {
            surfaceId: "one",
            catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
          },
        },
        { createSurface: { surfaceId: "unversioned" } },
      ],
      CATALOG_ID,
    );

    expect(messages).toEqual([
      {
        version: "v0.9",
        createSurface: { surfaceId: "one", catalogId: CATALOG_ID },
      },
      {
        version: "v0.9",
        createSurface: { surfaceId: "unversioned", catalogId: CATALOG_ID },
      },
    ]);
  });

  it("drops anything that is not a v0.9 message, with a warning each", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const legacy = { beginRendering: { surfaceId: "legacy" } };

    const messages = normalizeA2UIOperations([legacy, null], CATALOG_ID);

    expect(messages).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("not an A2UI v0.9 message"),
      legacy,
      expect.any(Array),
    );
    warn.mockRestore();
  });
});

function text(surfaceId: string, value: string) {
  return {
    version: "v0.9",
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
      {
        version: "v0.9",
        createSurface: { surfaceId: "a", catalogId: "other" },
      },
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
      {
        version: "v0.9",
        createSurface: { surfaceId: "a", catalogId: CATALOG_ID },
      },
      text("a", "first"),
    ];
    applyA2UIOperations(target, created, CATALOG_ID);

    const surfaces = applyA2UIOperations(
      target,
      [
        ...created,
        { version: "v0.9", deleteSurface: { surfaceId: "a" } },
        {
          version: "v0.9",
          createSurface: { surfaceId: "a", catalogId: CATALOG_ID },
        },
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
        [
          text("a", "x"),
          { version: "v0.9", deleteSurface: { surfaceId: "a" } },
        ],
        CATALOG_ID,
      ),
    ).toEqual([]);
  });
});
