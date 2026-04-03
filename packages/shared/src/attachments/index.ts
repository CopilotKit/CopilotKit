export type {
  AttachmentsConfig,
  Attachment,
  AttachmentModality,
} from "./types";

export {
  getModalityFromMimeType,
  formatFileSize,
  exceedsMaxSize,
  readFileAsBase64,
  generateVideoThumbnail,
  matchesAcceptFilter,
  getSourceUrl,
  getDocumentIcon,
} from "./utils";
