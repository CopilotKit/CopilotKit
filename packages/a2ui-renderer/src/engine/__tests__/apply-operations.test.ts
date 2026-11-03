import { describe, expect, it, vi } from "vitest";
import { Catalog, MessageProcessor } from "@a2ui/web_core/v0_9";
import type { ComponentApi } from "@a2ui/web_core/v0_9";
import { BASIC_COMPONENTS } from "@a2ui/web_core/v0_9/basic_catalog";
import { A2UI_BASIC_CATALOG_ID } from "../../catalog-ids";
import {
  A2UIOperationApplier,
  applyA2UIOperations,
  normalizeA2UIOperations,
} from "../apply-operations";

const CATALOG_ID = A2UI_BASIC_CATALOG_ID;
const basicCatalog = new Catalog<ComponentApi>(CATALOG_ID, BASIC_COMPONENTS);

const create = (surfaceId: string, catalogId = CATALOG_ID) => ({
  version: "v0.9",
  createSurface: { surfaceId, catalogId },
});
const components = (surfaceId: string, text: string, id = "root") => ({
  version: "v0.9",
  updateComponents: {
    surfaceId,
    components: [{ id, component: "Text", text }],
  },
});

function createApplier() {
  const processor = new MessageProcessor<ComponentApi>([basicCatalog]);
  const applier = new A2UIOperationApplier(processor, CATALOG_ID);
  return { processor, applier };
}

function rootText(
  processor: MessageProcessor<ComponentApi>,
  surfaceId: string,
) {
  const root = processor.model
    .getSurface(surfaceId)
    ?.componentsModel.get("root");
  return root?.properties.text;
}

describe("normalizeA2UIOperations", () => {
  it("adds the v0.9 version and pins createSurface to the renderer's catalog", () => {
    const [message] = normalizeA2UIOperations(
      [{ createSurface: { surfaceId: "s", catalogId: "stray" } }],
      CATALOG_ID,
    );
    expect(message).toEqual({
      version: "v0.9",
      createSurface: { surfaceId: "s", catalogId: CATALOG_ID },
    });
  });

  it("ignores keys outside the message, such as a top-level surfaceId", () => {
    const [message] = normalizeA2UIOperations(
      [{ surfaceId: "top", deleteSurface: { surfaceId: "nested" } }],
      CATALOG_ID,
    );
    expect(message).toEqual({
      version: "v0.9",
      deleteSurface: { surfaceId: "nested" },
    });
  });

  it("reads a missing version as v0.9", () => {
    expect(
      normalizeA2UIOperations(
        [{ deleteSurface: { surfaceId: "s" } }],
        CATALOG_ID,
      ),
    ).toEqual([{ version: "v0.9", deleteSurface: { surfaceId: "s" } }]);
  });

  it("drops anything that is not a v0.9 message, with a warning each", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const legacy = { beginRendering: { surfaceId: "legacy" } };
    expect(normalizeA2UIOperations([legacy, null], CATALOG_ID)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("not an A2UI v0.9 message"),
      legacy,
      expect.any(Array),
    );
    warn.mockRestore();
  });
});

describe("A2UIOperationApplier", () => {
  it("renders a surface whose createSurface names a stray catalog", () => {
    const { processor, applier } = createApplier();
    applier.apply([create("s", "unknown-catalog"), components("s", "Hi")]);
    expect(rootText(processor, "s")).toBe("Hi");
  });

  it("creates a surface on demand for operations that arrive before createSurface", () => {
    const { processor, applier } = createApplier();
    const surfaces = applier.apply([components("late", "Hi")]);
    expect(surfaces.map((surface) => surface.id)).toEqual(["late"]);
    expect(rootText(processor, "late")).toBe("Hi");
  });

  it("returns the same array for an identical snapshot", () => {
    const { applier } = createApplier();
    const operations = [create("s"), components("s", "Hi")];
    const first = applier.apply(operations);
    expect(applier.apply([...operations])).toBe(first);
  });

  it("applies only the new operations of a snapshot that extends the last one", () => {
    const { processor, applier } = createApplier();
    applier.apply([create("s"), components("s", "One")]);
    const surface = processor.model.getSurface("s");
    applier.apply([
      create("s"),
      components("s", "One"),
      components("s", "Two"),
    ]);
    expect(processor.model.getSurface("s")).toBe(surface);
    expect(rootText(processor, "s")).toBe("Two");
  });

  it("starts over when the history changed", () => {
    const { processor, applier } = createApplier();
    applier.apply([create("a"), components("a", "A")]);
    applier.apply([create("b"), components("b", "B")]);
    expect([...processor.model.surfacesMap.keys()]).toEqual(["b"]);
  });

  it("clears the surfaces for an empty snapshot", () => {
    const { applier } = createApplier();
    applier.apply([create("s"), components("s", "Hi")]);
    expect(applier.apply([])).toEqual([]);
  });

  it("starts over and rethrows when a batch throws", () => {
    const { processor, applier } = createApplier();
    applier.apply([create("s"), components("s", "Hi")]);
    vi.spyOn(processor, "processMessages").mockImplementationOnce(() => {
      throw new Error("processor failed");
    });
    expect(() =>
      applier.apply([
        create("s"),
        components("s", "Hi"),
        components("s", "Next"),
      ]),
    ).toThrow("processor failed");
    expect(processor.model.surfacesMap.size).toBe(0);
  });
});

describe("applyA2UIOperations", () => {
  it("creates missing surfaces with the theme and skips creating existing ones", () => {
    const processor = new MessageProcessor<ComponentApi>([basicCatalog]);
    const operations = [
      create("a", "other"),
      components("a", "created"),
      components("implicit", "x"),
    ];

    const surfaces = applyA2UIOperations(processor, operations, CATALOG_ID, {
      accent: "blue",
    });
    expect(surfaces.map((surface) => surface.id)).toEqual(["a", "implicit"]);
    expect(processor.model.getSurface("implicit")?.theme).toEqual({
      accent: "blue",
    });

    // Replaying the same, grown list neither throws nor duplicates surfaces.
    applyA2UIOperations(
      processor,
      [...operations, components("a", "updated")],
      CATALOG_ID,
    );
    expect(rootText(processor, "a")).toBe("updated");
  });

  it("recreates a surface that the list deletes and creates again", () => {
    const processor = new MessageProcessor<ComponentApi>([basicCatalog]);
    const surfaces = applyA2UIOperations(
      processor,
      [
        create("a"),
        components("a", "first"),
        { version: "v0.9", deleteSurface: { surfaceId: "a" } },
        create("a"),
        components("a", "second"),
      ],
      CATALOG_ID,
    );
    expect(surfaces).toHaveLength(1);
    expect(rootText(processor, "a")).toBe("second");
  });

  it("drops deleted surfaces from the result", () => {
    const processor = new MessageProcessor<ComponentApi>([basicCatalog]);
    expect(
      applyA2UIOperations(
        processor,
        [
          components("a", "x"),
          { version: "v0.9", deleteSurface: { surfaceId: "a" } },
        ],
        CATALOG_ID,
      ),
    ).toEqual([]);
  });
});
