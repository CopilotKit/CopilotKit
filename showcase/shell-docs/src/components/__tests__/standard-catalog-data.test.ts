import { describe, expect, it } from "vitest";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";
import {
  SAMPLES,
  sampleOperations,
  sampleSurfaceId,
} from "@/components/standard-catalog/catalog-data";

describe("standard catalog samples", () => {
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
          version: "v1.0",
          updateDataModel: { surfaceId, path: "/", value: sample.data },
        });
    }
  });
});
