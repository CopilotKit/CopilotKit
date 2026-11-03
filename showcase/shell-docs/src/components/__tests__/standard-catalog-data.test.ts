import { describe, expect, it } from "vitest";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import { validateOperation } from "@copilotkit/shared";
import {
  SAMPLES,
  sampleOperations,
  sampleSurfaceId,
} from "@/components/standard-catalog/catalog-data";

describe("standard catalog samples", () => {
  it("emits canonical operations accepted by the published renderer", () => {
    const manifest = {
      catalogId: standardUI.id,
      catalogIds: [standardUI.id],
      components: standardUI.manifestComponents,
    };
    for (const [index, sample] of SAMPLES.entries()) {
      const surfaceId = sampleSurfaceId(index);
      const knownSurfaces = new Set<string>();
      for (const operation of sampleOperations(
        sample,
        surfaceId,
        standardUI.id,
      )) {
        expect(operation.version, sample.title).toBe("1.0");
        expect(
          validateOperation(operation, { manifest, knownSurfaces }),
          sample.title,
        ).toEqual({ ok: true });
        if ("createSurface" in operation) knownSurfaces.add(surfaceId);
      }
    }
  });

  it("covers the actual standard catalog without stale or invented component names", () => {
    const actual = Object.keys(standardUI.manifestComponents).sort();
    const covered = [
      ...new Set(SAMPLES.flatMap((sample) => sample.covers)),
    ].sort();
    expect(covered).toEqual(actual);
    for (const sample of SAMPLES) {
      const renderedNames = sample.components.map(
        (component) => component.component,
      );
      for (const name of sample.covers) expect(renderedNames).toContain(name);
    }
  });

  it("gives every sample a distinct surface and includes its initial data in the copyable operations", () => {
    expect(
      new Set(SAMPLES.map((_, index) => sampleSurfaceId(index))).size,
    ).toBe(SAMPLES.length);
    for (const [index, sample] of SAMPLES.entries()) {
      const surfaceId = sampleSurfaceId(index);
      const operations = sampleOperations(sample, surfaceId, standardUI.id);
      expect(operations[0]).toMatchObject({
        createSurface: { surfaceId, catalogId: standardUI.id },
      });
      expect(operations.at(-1)).toMatchObject({
        updateComponents: { surfaceId, components: sample.components },
      });
      if (sample.data)
        expect(operations).toContainEqual({
          version: "1.0",
          updateDataModel: { surfaceId, path: "/", value: sample.data },
        });
    }
  });
});
