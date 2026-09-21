import type { InputContent } from "@ag-ui/core";
import type { Attachment } from "./types";

/** Build the AG-UI content part used when sending a ready attachment. */
export function createAttachmentContent(
  attachment: Pick<Attachment, "type" | "source" | "filename" | "metadata">,
): InputContent {
  return {
    type: attachment.type,
    source: attachment.source,
    metadata: {
      ...(attachment.filename ? { filename: attachment.filename } : {}),
      ...attachment.metadata,
    },
  };
}
