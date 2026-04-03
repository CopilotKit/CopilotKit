import type {
  InputContentDataSource,
  InputContentUrlSource,
} from "@ag-ui/core";

export interface AttachmentsConfig {
  /** Enable file attachments in the chat input */
  enabled: boolean;
  /** MIME type filter for the file input, default all files */
  accept?: string;
  /** Maximum file size in bytes, default 20MB (20 * 1024 * 1024) */
  maxSize?: number;
  /** Custom upload handler. Return { data, mimeType } for base64 or { url, mimeType? } for URL-based delivery. */
  onUpload?: (
    file: File,
  ) => Promise<
    { data: string; mimeType: string } | { url: string; mimeType?: string }
  >;
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
}
