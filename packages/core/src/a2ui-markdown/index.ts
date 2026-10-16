export { A2UI_FENCE_LANGUAGE, splitA2UIMarkdown } from "./fence-parser";
export type { MarkdownSegment } from "./fence-parser";
export {
  classifySurfaceCards,
  extractCompleteArrayItems,
  extractFenceOperations,
  extractStringField,
  flattenInformationalCards,
  getMarkdownOperationSurfaceId,
  prepareSurfaceOperations,
  segmentSurfaceProse,
} from "./operations";
export type { A2UIMarkdownOperation, SurfaceSegment } from "./operations";
