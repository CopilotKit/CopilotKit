import type {
  AttachmentModality,
  InputContentSource,
} from "@copilotkit/shared";

export type { AttachmentModality, InputContentSource };

/**
 * Context passed to a per-modality slot when overriding the default
 * `CopilotChatAttachmentRenderer` rendering.
 */
export interface AttachmentRendererSlotContext {
  type: AttachmentModality;
  source: InputContentSource;
  src: string;
  filename?: string;
  inputClass?: string;
}
