export { SAMPLES } from "../../../../shared/generative-ui-catalog/samples";
export type { CatalogSample } from "../../../../shared/generative-ui-catalog/samples";
export {
  sampleOperations,
  sampleSurfaceId,
} from "../../../../shared/generative-ui-catalog/operations";

export function catalogGroupId(group: string) {
  return `catalog-${group.toLowerCase().replace(/\s+/g, "-")}`;
}
