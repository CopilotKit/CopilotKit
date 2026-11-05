import React, { Fragment } from "react";
import type { ContentPart } from "@ag-ui/core";
import { CopilotChatAttachmentRenderer } from "./CopilotChatAttachmentRenderer";

/** Render saved content in its original order without resolving provider handles. */
export function CopilotChatContentParts({
  content,
  renderText = (text) => (
    <span className="cpk:whitespace-pre-wrap">{text}</span>
  ),
}: {
  content: ContentPart[];
  renderText?: (text: string, index: number) => React.ReactNode;
}) {
  const normalized: ContentPart[] = [];
  for (const part of content) {
    const previous = normalized.at(-1);
    if (part.type === "text" && previous?.type === "text")
      previous.text += part.text;
    else normalized.push({ ...part });
  }
  return (
    <>
      {normalized.map((part, index) => (
        <Fragment key={index}>
          {part.type === "text" ? (
            renderText(part.text, index)
          ) : (
            <CopilotChatAttachmentRenderer
              type={part.type}
              source={part.source}
              filename={
                typeof part.metadata?.filename === "string"
                  ? part.metadata.filename
                  : undefined
              }
            />
          )}
        </Fragment>
      ))}
    </>
  );
}
