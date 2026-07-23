import type { UserMessage } from "@ag-ui/core";
import type {
  AudioInputPart,
  DocumentInputPart,
  ImageInputPart,
  VideoInputPart,
} from "@copilotkit/shared";

export type UserMessageMediaPart =
  | ImageInputPart
  | AudioInputPart
  | VideoInputPart
  | DocumentInputPart;

export function flattenUserMessageContent(
  content?: UserMessage["content"],
): string {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

export function getUserMessageMediaParts(
  content?: UserMessage["content"],
): UserMessageMediaPart[] {
  if (!content || typeof content === "string") {
    return [];
  }

  return content.filter(
    (part): part is UserMessageMediaPart =>
      part.type === "image" ||
      part.type === "audio" ||
      part.type === "video" ||
      part.type === "document",
  );
}

export function getUserMessageMediaFilename(
  part: UserMessageMediaPart,
): string | undefined {
  const meta = part.metadata;
  if (
    meta != null &&
    typeof meta === "object" &&
    "filename" in meta &&
    typeof meta.filename === "string"
  ) {
    return meta.filename;
  }
  return undefined;
}
