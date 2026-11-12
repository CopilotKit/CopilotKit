import type { CatalogSample } from "./samples";

export function sampleSurfaceId(index: number) {
  return `sample-${index}`;
}

/** The same operations drive the live preview and its copyable example. */
export function sampleOperations(
  sample: CatalogSample,
  surfaceId: string,
  catalogId: string,
) {
  return [
    { version: "1.0", createSurface: { surfaceId, catalogId } },
    ...(sample.data === undefined
      ? []
      : [
          {
            version: "1.0",
            updateDataModel: { surfaceId, path: "/", value: sample.data },
          },
        ]),
    {
      version: "1.0",
      updateComponents: { surfaceId, components: sample.components },
    },
  ];
}
