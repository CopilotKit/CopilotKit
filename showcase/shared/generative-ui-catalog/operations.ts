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
    { version: "v1.0", createSurface: { surfaceId, catalogId } },
    ...(sample.data === undefined
      ? []
      : [
          {
            version: "v1.0",
            updateDataModel: { surfaceId, path: "/", value: sample.data },
          },
        ]),
    {
      version: "v1.0",
      updateComponents: { surfaceId, components: sample.components },
    },
  ];
}
