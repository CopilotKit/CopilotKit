import type { Attachment } from "@copilotkit/shared";

export type { Attachment };

/**
 * Context passed to a custom queue container slot.
 */
export interface AttachmentQueueContainerContext {
  attachments: Attachment[];
  inputClass?: string;
}

/**
 * Context passed to a custom queue item slot.
 *
 * `clickHandler` runs when the user activates the remove control. We keep the
 * naming convention `clickHandler` (not `onClick`) to avoid the Angular
 * NG0306 issue when binding to custom-component inputs.
 */
export interface AttachmentQueueItemContext {
  attachment: Attachment;
  isUploading: boolean;
  src: string;
  /** Invoke to remove this attachment from the queue. */
  clickHandler: () => void;
}

export interface AttachmentQueueRemoveEvent {
  id: string;
  attachment: Attachment;
}
