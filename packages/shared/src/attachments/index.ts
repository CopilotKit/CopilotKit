export type {
  AttachmentsConfig,
  AttachmentUploadResult,
  AttachmentUploadError,
  AttachmentUploadErrorReason,
  Attachment,
  AttachmentModality,
} from "./types";

export { createAttachmentContent } from "./content";

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
