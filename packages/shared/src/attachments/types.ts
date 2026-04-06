import type {
  InputContentDataSource,
  InputContentUrlSource,
} from "@ag-ui/core";

export interface AttachmentUploadDataResult {
  type: "data";
  value: string;
  mimeType: string;
  /** Custom metadata to include in the InputContent part (merged with auto-generated metadata like filename). */
  metadata?: Record<string, unknown>;
}

export interface AttachmentUploadUrlResult {
  type: "url";
  value: string;
  mimeType?: string;
  /** Custom metadata to include in the InputContent part (merged with auto-generated metadata like filename). */
  metadata?: Record<string, unknown>;
}

export type AttachmentUploadResult =
  | AttachmentUploadDataResult
  | AttachmentUploadUrlResult;

export type AttachmentUploadErrorReason =
  | "file-too-large"
  | "invalid-type"
  | "upload-failed";

export interface AttachmentUploadError {
  /** Why the upload failed. */
  reason: AttachmentUploadErrorReason;
  /** The file that failed to upload. */
  file: File;
  /** Human-readable error message. */
  message: string;
}

export interface AttachmentsConfig {
  /** Enable file attachments in the chat input */
  enabled: boolean;
  /** MIME type filter for the file input, default all files */
  accept?: string;
  /** Maximum file size in bytes, default 20MB (20 * 1024 * 1024) */
  maxSize?: number;
  /** Custom upload handler. Return an InputContentSource with optional metadata. */
  onUpload?: (
    file: File,
  ) => AttachmentUploadResult | Promise<AttachmentUploadResult>;
  /** Called when an attachment fails validation or upload. Use this to show a toast or inline error. */
  onUploadFailed?: (error: AttachmentUploadError) => void;
}

export type AttachmentModality = "image" | "audio" | "video" | "document";

export interface Attachment {
  id: string;
  type: AttachmentModality;
  source: InputContentDataSource | InputContentUrlSource;
  filename?: string;
  size?: number;
  status: "uploading" | "ready";
  thumbnail?: string;
  /** Custom metadata from onUpload, included in the InputContent part. */
  metadata?: Record<string, unknown>;
}
